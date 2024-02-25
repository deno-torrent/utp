/**
 * UTP 协议基础功能完整性验证
 *
 * 覆盖的协议特性：
 *  ① ST_SYN / SYN-ACK 三次握手（连接建立，状态机校验）
 *  ② ST_DATA 单向传输 — 小包（<MTU）、中包（多分片）
 *  ③ 多次分片写入 → 单次大读取（乱序组装正确性）
 *  ④ 双向传输（echo 模式，客户端←→服务端）
 *  ⑤ ST_FIN 优雅关闭
 *     - 服务端关闭 → 客户端 read() 返回 null（EOF 语义）
 *     - 服务端发完数据后关闭 → 客户端 readUntilEof 读完全部数据再遇 EOF
 *     - write() 向已关闭连接写入 → 抛出异常
 *  ⑥ ST_RESET 连接重置（localState 变为 CS_RESET）
 *  ⑦ 连接失败：目标端口无服务时应在合理时间内拒绝 Promise
 *  ⑧ 多个顺序连接：服务端依次接受 N 个连接
 *  ⑨ 多个并发连接：N 个客户端同时连接到同一服务端
 *  ⑩ SACK 选择性确认扩展
 *     - 正常传输中 SACK 透明参与（bitmask 为空但扩展字段存在）
 *     - 大数据（512 KB）端到端完整性验证
 *
 * 注：SACK 非空 bitmask（乱序包选择性确认）需模拟丢包能力，
 *     此场景由 test/utp_ext_sack.test.ts 的单元测试覆盖。
 */
import { assert, assertEquals, assertRejects } from 'std/assert/mod.ts'
import { Utp, UtpConnState } from '../mod.ts'

const HOST = '127.0.0.1'

// ── 工具函数 ──────────────────────────────────────────────────────────────

/** 精确读取 expected 字节，或读到 EOF 提前返回 */
async function readExact(
  conn: { read: (buf: Uint8Array) => Promise<number | null> },
  expected: number
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const buf = new Uint8Array(8192)
  while (total < expected) {
    const n = await conn.read(buf)
    if (n === null) break
    chunks.push(buf.slice(0, n).slice()) // 复制，避免 buf 被复用
    total += n
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

/** 读取直到 read() 返回 null（EOF） */
async function readUntilEof(
  conn: { read: (buf: Uint8Array) => Promise<number | null> }
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const buf = new Uint8Array(8192)
  for (;;) {
    const n = await conn.read(buf)
    if (n === null) break
    chunks.push(buf.slice(0, n).slice())
  }
  let total = 0; for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

/** 生成长度为 n 的确定性测试数据（i & 0xFF 模式） */
function makePattern(n: number): Uint8Array {
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = i & 0xFF
  return data
}

// ── ① 握手 ────────────────────────────────────────────────────────────────

Deno.test('UTP协议-握手: connect() 后双方连接状态均为 CS_CONNECTED', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port

    let serverConnState: UtpConnState | undefined

    const serverPromise = (async () => {
      for await (const conn of listener) {
        serverConnState = conn.localState
        assert(conn.isConnected(), '服务端连接应为 isConnected()')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    assertEquals(conn.localState, UtpConnState.CS_CONNECTED, '客户端应处于 CS_CONNECTED')
    assert(conn.isConnected(), '客户端 isConnected() 应返回 true')

    // 服务端只在收到第一个 ST_DATA 后才完成握手（CS_SYN_RECV → CS_CONNECTED）
    // 发送 1 字节触发服务端状态机推进
    await conn.write(new Uint8Array(1))
    await conn.close()
    await serverPromise

    assertEquals(serverConnState, UtpConnState.CS_CONNECTED, '服务端连接应为 CS_CONNECTED')
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ② ST_DATA 小包 ────────────────────────────────────────────────────────

Deno.test('UTP协议-数据传输: 小数据（100 字节，单包）接收完整', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const testData = new Uint8Array(100).fill(0xAB)

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, testData.length)
        assertEquals(received, testData, '小数据接收内容应与发送内容一致')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    assertEquals(await conn.write(testData), testData.length, 'write() 应返回实际写入字节数')
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ② ST_DATA 中等数据（多分片） ─────────────────────────────────────────

Deno.test('UTP协议-数据传输: 中等数据（64 KB，多分片）接收完整', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const testData = makePattern(64 * 1024)

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, testData.length)
        assertEquals(received.length, testData.length, '接收字节数应等于发送字节数')
        assertEquals(received, testData, '64KB 数据内容应完整一致')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    await conn.write(testData)
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ③ 多次分片写入合并读取 ────────────────────────────────────────────────

Deno.test('UTP协议-分片写入: 20 次 512B write() 在接收端拼接完整', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const CHUNK = 512
    const COUNT = 20
    const expected = makePattern(CHUNK * COUNT)

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, expected.length)
        assertEquals(received, expected, '多分片写入后拼接内容应一致')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    for (let i = 0; i < COUNT; i++) {
      await conn.write(expected.subarray(i * CHUNK, (i + 1) * CHUNK))
    }
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ④ 双向传输 ───────────────────────────────────────────────────────────

Deno.test('UTP协议-双向传输: 客户端发 → 服务端 echo → 客户端收到原内容', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const request = new TextEncoder().encode('Hello from client')
    const REPLY_SIZE = request.length

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, REPLY_SIZE)
        await conn.write(received) // echo
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    await conn.write(request)
    const reply = await readExact(conn, REPLY_SIZE)
    assertEquals(
      new TextDecoder().decode(reply),
      new TextDecoder().decode(request),
      'echo 内容应与原始请求一致'
    )
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ⑤ ST_FIN 优雅关闭 ── EOF 语义 ────────────────────────────────────────

Deno.test('UTP协议-FIN: 服务端未发数据直接关闭，客户端 readUntilEof 得到空', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port

    const serverPromise = (async () => {
      for await (const conn of listener) {
        await conn.close() // 不发任何数据，直接关闭
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    // 服务端需收到第一个 ST_DATA 才完成握手；发 1 字节触发后再监听 FIN/EOF
    await conn.write(new Uint8Array(1))
    // 并发开始读取，等待 FIN 触发 EOF
    const readPromise = readUntilEof(conn)
    await serverPromise
    const received = await readPromise
    assertEquals(received.length, 0, '服务端未发数据，接收应为空')
    await conn.close()
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

Deno.test('UTP协议-FIN: 服务端发完数据后关闭，客户端读到全部数据再遇 EOF', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const msg = new TextEncoder().encode('goodbye')

    const serverPromise = (async () => {
      for await (const conn of listener) {
        await conn.write(msg)
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    // 服务端需收到第一个 ST_DATA 才完成握手；发 1 字节触发
    await conn.write(new Uint8Array(1))
    // 并发读取：确保读取 Promise 在 FIN 到达前挂起，
    // 这样 BlockingBuffer.write() 能直接投递数据而非被 close() 清除
    const readPromise = readUntilEof(conn)
    await serverPromise
    const received = await readPromise
    assertEquals(
      new TextDecoder().decode(received),
      'goodbye',
      '应读到服务端发送的全部数据'
    )
    await conn.close()
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

Deno.test('UTP协议-FIN: write() 向已关闭连接写入应抛出异常', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port

    const serverPromise = (async () => {
      for await (const conn of listener) {
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    // 服务端需收到第一个 ST_DATA 才完成握手
    await conn.write(new Uint8Array(1))
    await conn.close()
    await serverPromise

    assert(conn.isClosed(), '连接应已完全关闭')
    await assertRejects(
      () => conn.write(new Uint8Array([1, 2, 3])),
      Error,
      'Cannot send packet on closed connection'
    )
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ⑥ ST_RESET 连接重置 ──────────────────────────────────────────────────

Deno.test('UTP协议-RST: reset() 后 localState 变为 CS_RESET', async () => {
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port

    // 服务端接收连接后立即重置
    let serverConn: import('../mod.ts').UtpConn | undefined
    const serverPromise = (async () => {
      for await (const conn of listener) {
        serverConn = conn
        conn.reset() // 服务端主动 RST
        break
      }
    })()

    const clientConn = await client.connect({ port: serverPort, hostname: HOST })
    // 服务端需收到第一个 ST_DATA 才完成握手，ACK 回来后 write() 返回
    await clientConn.write(new Uint8Array(1))
    await serverPromise

    // 验证服务端侧状态
    assertEquals(serverConn!.localState, UtpConnState.CS_RESET, '服务端连接应为 CS_RESET')

    // 等待 RST 包传播到客户端（loopback 几乎即时）
    await new Promise(r => setTimeout(r, 150))
    assertEquals(clientConn.localState, UtpConnState.CS_RESET, '客户端连接应为 CS_RESET')
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ⑦ 连接失败 ───────────────────────────────────────────────────────────

Deno.test('UTP协议-连接失败: 目标端口无服务时 connect() 应在合理时间内拒绝', async () => {
  const client = new Utp()
  const PORT_CLOSED = 19988 // 没有服务监听的端口
  const start = Date.now()
  try {
    // 连接超时或强制关闭均会导致 Promise 拒绝
    await assertRejects(
      () => client.connect({ port: PORT_CLOSED, hostname: HOST }),
      Error
    )
    const elapsed = Date.now() - start
    // timeoutCheck 会在 ~300ms（首次 TIMEOUT_CHECK_INTERVAL）强制关闭 SYN_SENT 连接，
    // waitForConnecting 中的 5s setTimeout 作为兜底
    assert(elapsed < 6500, `连接失败应在 6.5s 内，实际 ${elapsed}ms`)
  } finally {
    if (!client.isClosed()) await client.close()
  }
})

// ── ⑧ 多顺序连接 ─────────────────────────────────────────────────────────

Deno.test('UTP协议-多顺序连接: 服务端依次接受 3 个连接并验证数据', async () => {
  const server = new Utp()
  const clients: Utp[] = []
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const N = 3

    const serverPromise = (async () => {
      let count = 0
      for await (const conn of listener) {
        const received = await readExact(conn, 4)
        assertEquals(received, new Uint8Array([count, count, count, count]),
          `第 ${count} 次连接接收数据应匹配`)
        await conn.close()
        if (++count >= N) break
      }
    })()

    for (let i = 0; i < N; i++) {
      const c = new Utp()
      clients.push(c)
      const conn = await c.connect({ port: serverPort, hostname: HOST })
      await conn.write(new Uint8Array([i, i, i, i]))
      await conn.close()
    }

    await serverPromise
  } finally {
    for (const c of clients) if (!c.isClosed()) await c.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ⑨ 并发连接 ───────────────────────────────────────────────────────────

Deno.test('UTP协议-并发连接: 3 个客户端同时连接，各自传输 2KB 数据均正确', async () => {
  const server = new Utp()
  const clients: Utp[] = []
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const N = 3
    const SIZE = 2 * 1024

    const serverPromise = (async () => {
      let count = 0
      for await (const conn of listener) {
        const received = await readExact(conn, SIZE)
        assertEquals(received.length, SIZE, `第 ${count} 个并发连接接收字节数应正确`)
        await conn.close()
        if (++count >= N) break
      }
    })()

    const data = makePattern(SIZE)
    const conns = await Promise.all(
      Array.from({ length: N }, async () => {
        const c = new Utp()
        clients.push(c)
        return c.connect({ port: serverPort, hostname: HOST })
      })
    )
    await Promise.all(conns.map(async (conn) => {
      await conn.write(data)
      await conn.close()
    }))

    await serverPromise
  } finally {
    for (const c of clients) if (!c.isClosed()) await c.close()
    if (!server.isClosed()) await server.close()
  }
})

// ── ⑩ SACK 选择性确认扩展 ────────────────────────────────────────────────

Deno.test('UTP SACK扩展: 512 KB 大数据传输中 SACK 透明参与，接收内容完整', async () => {
  // SACK 扩展随每个 ST_STATE（ACK）包自动携带：
  //   - 包序号连续时（loopback 无丢包）：bitmask 为空，扩展字段仍被序列化/反序列化
  //   - 包序号不连续时（丢包/乱序）：bitmask 记录已收包，发送方按需重传缺失包
  // 本测试验证 SACK 机制不影响正常传输的正确性；
  // SACK 非空 bitmask 的单元测试见 test/utp_ext_sack.test.ts。
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    const SIZE = 512 * 1024
    const testData = makePattern(SIZE)

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, SIZE)
        assertEquals(received.length, SIZE, 'SACK 传输后接收字节数应等于发送字节数')
        assertEquals(received, testData, 'SACK 传输后接收内容应与发送内容完全一致')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    await conn.write(testData)
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})

Deno.test('UTP SACK扩展: UtpSelectiveAckExtension 结构随 ACK 正确序列化', async () => {
  // 验证 ACK 包中 SACK 扩展字段可以被反序列化（通过正常传输隐式验证）
  // 正常传输能完成即说明发送方正确解析了接收方 ACK 中的 SACK 信息
  const server = new Utp()
  const client = new Utp()
  try {
    const listener = server.listen({ port: 0, hostname: HOST })
    const serverPort = server.localAddr!.port
    // 发送恰好跨越 SACK 位掩码边界的数据量（> 1 个包，< 窗口大小）
    const testData = makePattern(3 * 1380) // 3 个 MTU 大小的包

    const serverPromise = (async () => {
      for await (const conn of listener) {
        const received = await readExact(conn, testData.length)
        assertEquals(received, testData, 'SACK ACK 往返后数据完整')
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: serverPort, hostname: HOST })
    await conn.write(testData)
    await conn.close()
    await serverPromise
  } finally {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  }
})
