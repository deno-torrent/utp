/**
 * BitTorrent 握手测试（uTP 传输层）
 *
 * 通过 uTP 连接到本地运行的 Transmission BitTorrent 客户端，
 * 执行标准的 BitTorrent 握手协议，验证 uTP 库能与真实的 BitTorrent
 * 实现正常通信。
 *
 * 环境要求：
 *  - 本机安装并运行 transmission-daemon（监听 127.0.0.1:51413）
 *  - Ubuntu torrent 已添加到 Transmission（用于提供合法的 info_hash）
 *    transmission-remote 127.0.0.1:9091 --auth transmission:transmission \
 *      --add test/ubuntu-24.04.4-live-server-amd64.iso.torrent --download-dir /tmp
 *
 * 测试流程：
 *  1. 读取 .torrent 文件，计算 info_hash（SHA-1 of bencoded info dict）
 *  2. 通过 uTP 连接到 Transmission（127.0.0.1:51413）
 *  3. 发送 BitTorrent 握手消息（68 字节）
 *  4. 接收并验证 Transmission 的握手响应
 *  5.（可选）向 HTTP Tracker 请求 Peer 列表，尝试外网握手
 *
 * BitTorrent 握手格式（BEP 3）：
 *   ┌─────────┬────────────────────┬──────────┬────────────┬──────────┐
 *   │ pstrlen │       pstr         │ reserved │  info_hash │ peer_id  │
 *   │  1 byte │     19 bytes       │  8 bytes │  20 bytes  │ 20 bytes │
 *   └─────────┴────────────────────┴──────────┴────────────┴──────────┘
 */

import { assert } from 'std/assert/mod.ts'
import { Utp } from '../mod.ts'

// ── 常量 ──────────────────────────────────────────────────────────────────────

const BT_PSTR = 'BitTorrent protocol'
const BT_HANDSHAKE_LEN = 1 + 19 + 8 + 20 + 20 // 68 bytes

const TORRENT_FILE = new URL(
  './ubuntu-24.04.4-live-server-amd64.iso.torrent',
  import.meta.url,
).pathname

/** 本地 Transmission 监听地址 */
const LOCAL_PEER = { ip: '127.0.0.1', port: 51413 }

const TRACKER_URL = 'https://torrent.ubuntu.com/announce'

/** 单次握手尝试超时（毫秒） */
const PEER_TIMEOUT_MS = 8_000
/** 整个测试超时（毫秒） */
const TEST_TIMEOUT_MS = 60_000

// ── Bencode 工具 ──────────────────────────────────────────────────────────────

/**
 * 找到 bencode 值末尾位置（不解析内容，仅计算范围）。
 * 用于提取 info dict 的原始字节以计算 SHA-1。
 */
function bencodeEnd(buf: Uint8Array, pos: number): number {
  const c = buf[pos]
  if (c === 0x64) {
    // 'd' dict
    pos++
    while (buf[pos] !== 0x65) {
      pos = bencodeEnd(buf, pos) // key
      pos = bencodeEnd(buf, pos) // value
    }
    return pos + 1
  } else if (c === 0x6c) {
    // 'l' list
    pos++
    while (buf[pos] !== 0x65) pos = bencodeEnd(buf, pos)
    return pos + 1
  } else if (c === 0x69) {
    // 'i' int
    pos++
    while (buf[pos] !== 0x65) pos++
    return pos + 1
  } else {
    // string: <len>:<data>
    let len = 0
    while (buf[pos] !== 0x3a) len = len * 10 + (buf[pos++] - 48)
    return pos + 1 + len
  }
}

/** 解析 bencode，返回原生 JS 类型 */
type BVal = Uint8Array | number | BVal[] | Map<string, BVal>

function parseBencode(buf: Uint8Array, pos: number): [BVal, number] {
  const c = buf[pos]
  if (c === 0x64) {
    pos++
    const dict = new Map<string, BVal>()
    while (buf[pos] !== 0x65) {
      const [k, p1] = parseBencode(buf, pos)
      const [v, p2] = parseBencode(buf, p1)
      dict.set(new TextDecoder().decode(k as Uint8Array), v)
      pos = p2
    }
    return [dict, pos + 1]
  } else if (c === 0x6c) {
    pos++
    const list: BVal[] = []
    while (buf[pos] !== 0x65) {
      const [item, p] = parseBencode(buf, pos)
      list.push(item)
      pos = p
    }
    return [list, pos + 1]
  } else if (c === 0x69) {
    pos++
    let numStr = ''
    while (buf[pos] !== 0x65) numStr += String.fromCharCode(buf[pos++])
    return [parseInt(numStr), pos + 1]
  } else {
    let len = 0
    while (buf[pos] !== 0x3a) len = len * 10 + (buf[pos++] - 48)
    pos++
    return [buf.slice(pos, pos + len), pos + len]
  }
}

// ── info_hash 提取 ────────────────────────────────────────────────────────────

/**
 * 从 .torrent 文件字节中提取 info_hash（SHA-1 of raw bencoded info dict）。
 */
async function extractInfoHash(torrentBytes: Uint8Array): Promise<Uint8Array> {
  const marker = new TextEncoder().encode('4:info')
  let start = -1
  for (let i = 0; i <= torrentBytes.length - marker.length; i++) {
    if (marker.every((b, j) => torrentBytes[i + j] === b)) {
      start = i + marker.length
      break
    }
  }
  if (start === -1) throw new Error('torrent 文件中未找到 info 字段')
  const end = bencodeEnd(torrentBytes, start)
  const infoBytes = torrentBytes.slice(start, end)
  const hashBuf = await crypto.subtle.digest('SHA-1', infoBytes)
  return new Uint8Array(hashBuf)
}

// ── Tracker 请求（可选，仅用于信息展示） ────────────────────────────────────

interface Peer {
  ip: string
  port: number
}

async function getPeersFromTracker(infoHash: Uint8Array): Promise<Peer[]> {
  let encodedHash = ''
  for (const b of infoHash) encodedHash += '%' + b.toString(16).padStart(2, '0')

  const url =
    `${TRACKER_URL}?info_hash=${encodedHash}` +
    `&peer_id=-DE0001-aaaaaaaaaaaa` +
    `&port=6881&uploaded=0&downloaded=0&left=3405469696` +
    `&compact=0&numwant=5`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6_000)
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) return []
    const data = new Uint8Array(await resp.arrayBuffer())
    const [parsed] = parseBencode(data, 0)
    const dict = parsed as Map<string, BVal>
    if (dict.has('failure reason')) return []
    const peersVal = dict.get('peers')
    if (!peersVal || !Array.isArray(peersVal)) return []
    return peersVal.map((p) => {
      const d = p as Map<string, BVal>
      return {
        ip: new TextDecoder().decode(d.get('ip') as Uint8Array),
        port: d.get('port') as number,
      }
    })
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

// ── BitTorrent 握手构造 / 解析 ────────────────────────────────────────────────

/** 生成随机 Peer ID（-DE0001-<12位随机小写字母>） */
function makePeerId(): Uint8Array {
  const id = new Uint8Array(20)
  const prefix = new TextEncoder().encode('-DE0001-')
  id.set(prefix)
  const rand = new Uint8Array(12)
  crypto.getRandomValues(rand)
  for (let i = 0; i < 12; i++) id[8 + i] = (rand[i] % 26) + 97
  return id
}

/**
 * 构造 BitTorrent 握手消息（68 字节）。
 * 格式：pstrlen(1) | pstr(19) | reserved(8) | info_hash(20) | peer_id(20)
 */
function buildHandshake(infoHash: Uint8Array, peerId: Uint8Array): Uint8Array {
  const buf = new Uint8Array(BT_HANDSHAKE_LEN)
  buf[0] = BT_PSTR.length
  new TextEncoder().encode(BT_PSTR).forEach((b, i) => (buf[1 + i] = b))
  buf.set(infoHash, 28)
  buf.set(peerId, 48)
  return buf
}

/**
 * 解析对方发来的握手响应。
 * 返回 null 表示格式非法。
 */
function parseHandshake(data: Uint8Array): {
  pstr: string
  infoHash: Uint8Array
  peerId: Uint8Array
} | null {
  if (data.length < BT_HANDSHAKE_LEN) return null
  const pstrLen = data[0]
  if (pstrLen !== 19) return null
  const pstr = new TextDecoder().decode(data.slice(1, 20))
  if (pstr !== BT_PSTR) return null
  return {
    pstr,
    infoHash: data.slice(28, 48),
    peerId: data.slice(48, 68),
  }
}

/** 从连接读取恰好 n 字节，遇到 EOF 提前返回已读内容 */
async function readExact(
  conn: { read: (buf: Uint8Array) => Promise<number | null> },
  n: number,
): Promise<Uint8Array> {
  const result = new Uint8Array(n)
  let offset = 0
  const tmp = new Uint8Array(n)
  while (offset < n) {
    const read = await conn.read(tmp)
    if (read === null) break
    result.set(tmp.slice(0, read), offset)
    offset += read
  }
  return result.slice(0, offset)
}

// ── 核心：单次握手尝试 ────────────────────────────────────────────────────────

/**
 * 尝试通过 uTP 与单个 Peer 完成 BitTorrent 握手。
 * 成功返回握手解析结果，失败（超时 / 连接拒绝 / 协议错误）返回 null。
 */
async function tryHandshakeWithPeer(
  peer: Peer,
  infoHash: Uint8Array,
): Promise<{ pstr: string; infoHash: Uint8Array; peerId: Uint8Array } | null> {
  const client = new Utp(`bt-client-${peer.ip}:${peer.port}`)
  let conn: Awaited<ReturnType<typeof client.connect>> | null = null

  try {
    console.log(`  → 尝试连接 ${peer.ip}:${peer.port} ...`)

    const connectPromise = client.connect({ hostname: peer.ip, port: peer.port })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('连接超时')), PEER_TIMEOUT_MS),
    )
    conn = await Promise.race([connectPromise, timeout])

    console.log(`  ✓ uTP 连接建立（${peer.ip}:${peer.port}）`)

    // 发送握手
    const peerId = makePeerId()
    const handshake = buildHandshake(infoHash, peerId)
    await conn.write(handshake)
    console.log(`  → 握手消息已发送（${handshake.length} 字节）`)

    // 读取响应
    const readTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('读取握手响应超时')), PEER_TIMEOUT_MS),
    )
    const responseData = await Promise.race([
      readExact(conn, BT_HANDSHAKE_LEN),
      readTimeout,
    ])

    const parsed = parseHandshake(responseData)
    if (parsed === null) {
      console.log(`  ✗ 握手响应格式非法（收到 ${responseData.length} 字节）`)
      return null
    }

    // 解码对方 peer_id（显示可打印字符）
    const remoteId = new TextDecoder('latin1').decode(parsed.peerId)
    console.log(
      `  ✓ 握手成功！对方 peer_id: ${remoteId.replace(/[^\x20-\x7e]/g, '.')}`,
    )
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`  ✗ 失败: ${msg}`)
    return null
  } finally {
    if (conn) {
      try {
        await conn.close()
      } catch {
        // 忽略关闭时的错误
      }
    }
    try {
      await client.close()
    } catch {
      // 忽略 socket 关闭时的错误
    }
  }
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

Deno.test({
  name: 'BitTorrent 握手：通过 uTP 与本地 Transmission 握手（Ubuntu 24.04.4 torrent）',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const run = async () => {
      // ── Step 1: 读取 torrent，计算 info_hash ─────────────────────────────
      console.log('读取 torrent 文件...')
      const torrentBytes = await Deno.readFile(TORRENT_FILE)
      const infoHash = await extractInfoHash(torrentBytes)
      const infoHashHex = Array.from(infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      console.log(`info_hash: ${infoHashHex}`)
      assert(infoHash.length === 20, `info_hash 应为 20 字节，实际: ${infoHash.length}`)

      // ── Step 2: 向 Tracker 请求 Peer 列表（信息展示） ─────────────────────
      console.log('\n向 Tracker 请求 Peer 列表（仅展示）...')
      const trackerPeers = await getPeersFromTracker(infoHash)
      if (trackerPeers.length > 0) {
        console.log(`获取到 ${trackerPeers.length} 个 Peer:`)
        trackerPeers.forEach((p) => console.log(`  ${p.ip}:${p.port}`))
      } else {
        console.log('Tracker 无响应或无可用 Peer（不影响测试）')
      }

      // ── Step 3: 通过 uTP 与本地 Transmission 握手 ────────────────────────
      console.log(
        `\n通过 uTP 连接本地 Transmission（${LOCAL_PEER.ip}:${LOCAL_PEER.port}）...`,
      )

      const result = await tryHandshakeWithPeer(LOCAL_PEER, infoHash)
      assert(result !== null, 'uTP 握手失败：未能连接本地 Transmission')

      // ── Step 4: 验证握手内容 ──────────────────────────────────────────────
      // 4a. pstr 必须是 "BitTorrent protocol"
      assert(
        result.pstr === BT_PSTR,
        `pstr 不匹配: 期望 "${BT_PSTR}"，实际 "${result.pstr}"`,
      )

      // 4b. info_hash 必须与我们发送的一致
      const remoteHashHex = Array.from(result.infoHash)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      assert(
        remoteHashHex === infoHashHex,
        `对方 info_hash 不匹配: 期望 ${infoHashHex}，实际 ${remoteHashHex}`,
      )

      // 4c. peer_id 必须是 20 字节（非空）
      assert(result.peerId.length === 20, 'peer_id 应为 20 字节')
      const hasNonZero = result.peerId.some((b) => b !== 0)
      assert(hasNonZero, 'peer_id 不应全为 0')

      // 4d. 解码 Transmission peer_id（格式：-TR<version>-<random>）
      const remoteClientId = new TextDecoder('latin1')
        .decode(result.peerId)
        .replace(/[^\x20-\x7e]/g, '.')
      console.log(`\n对方客户端标识: ${remoteClientId}`)
      assert(
        remoteClientId.startsWith('-TR'),
        `peer_id 应以 "-TR" 开头（Transmission），实际: ${remoteClientId}`,
      )

      console.log('\n✓ uTP BitTorrent 握手验证通过')
      console.log(`  pstr:      "${result.pstr}"`)
      console.log(`  info_hash: ${remoteHashHex}`)
      console.log(`  peer_id:   ${remoteClientId}`)

      // ── Step 5: 尝试外网 Peer（可选，失败不影响测试结果） ─────────────────
      const ipv4TrackerPeers = trackerPeers.filter((p) => !p.ip.includes(':'))
      if (ipv4TrackerPeers.length > 0) {
        console.log(`\n尝试外网 Peer（可选，${ipv4TrackerPeers.length} 个 IPv4）...`)
        for (const peer of ipv4TrackerPeers) {
          const r = await tryHandshakeWithPeer(peer, infoHash)
          if (r !== null) {
            const id = new TextDecoder('latin1')
              .decode(r.peerId)
              .replace(/[^\x20-\x7e]/g, '.')
            console.log(`  ✓ 外网握手成功: ${peer.ip}:${peer.port} peer_id=${id}`)
          }
        }
      }
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`测试超时（${TEST_TIMEOUT_MS / 1000}s）`)),
        TEST_TIMEOUT_MS,
      ),
    )

    await Promise.race([run(), timeout])
  },
})
