# μTP — Micro Transport Protocol

A TypeScript implementation of the [μTP (Micro Transport Protocol)](https://www.bittorrent.org/beps/bep_0029.html) for [Deno](https://deno.land), based on BEP 29.

---

## English

### Features

- **Deno-native**: built on `Deno.listenDatagram`, implements `Reader / Writer / Closer`
- **BEP 29 compliant**: SACK, Extension Bits, and receive-window flow control
- **LEDBAT congestion control**: uses spare bandwidth without competing with TCP

### Requirements

- [Deno](https://deno.land) v1.40+

### Quick Start

```typescript
import { Utp } from './mod.ts'

// ── Server ──────────────────────────────────────────────────────────────────
const server = new Utp()
const listener = server.listen({ port: 9000 })

;(async () => {
  for await (const conn of listener) {
    const buf = new Uint8Array(4096)
    const n = await conn.read(buf)
    console.log('received:', n, 'bytes')
    conn.close()
  }
})()

// ── Client ──────────────────────────────────────────────────────────────────
const client = new Utp()
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

await conn.write(new TextEncoder().encode('hello μTP'))
conn.close()

await client.close()
await server.close()
```

### API

#### `Utp`

| Method | Description |
| ------ | ----------- |
| `listen(options)` | Start a server and return an async-iterable `UTPListener` |
| `connect(options)` | Dial a remote peer; resolves to a `UtpConn` on success |
| `close()` | Gracefully close the socket and all active connections |
| `localAddr` | Bound local address |

#### `UtpConn` (implements `Reader`, `Writer`, `Closer`)

| Method | Description |
| ------ | ----------- |
| `read(buf)` | Read incoming data; returns `null` on EOF |
| `write(data)` | Send data; throws if the connection is closed |
| `close()` | Initiate graceful close (`ST_FIN`) |

### Running Tests

```bash
deno test --allow-all --unstable-net
```

105 tests covering unit components, protocol correctness, large-file transfer (45 MB video), and concurrent connections.

### Architecture

```text
Utp (socket)
 ├─ UTPListener          — accept queue for incoming connections
 ├─ UtpConn              — per-connection state machine (CS_SYN_SENT → CS_CONNECTED → CS_CLOSED)
 │   ├─ BlockingBuffer   — receive byte buffer (256 KB, flow-control aware)
 │   ├─ UtpSendWindow    — in-flight packet tracker backed by BlockingMap
 │   ├─ UtpRttTracker    — smoothed RTT / RTO estimation
 │   └─ UtpCongestionControl  — LEDBAT delay-based algorithm
 └─ UtpPacket
     ├─ UtpSelectiveAckExtension  (type 1)
     └─ UtpExtensionBits          (type 2)
```

---

## 中文

### 功能特性

- **原生 Deno**：基于 `Deno.listenDatagram`，实现 `Reader / Writer / Closer` 接口
- **BEP 29 兼容**：支持 SACK、Extension Bits 及接收窗口流控
- **LEDBAT 拥塞控制**：利用空闲带宽，不与 TCP 竞争

### 环境要求

- [Deno](https://deno.land) v1.40+

### 快速开始

```typescript
import { Utp } from './mod.ts'

// ── 服务端 ───────────────────────────────────────────────────────────────────
const server = new Utp()
const listener = server.listen({ port: 9000 })

;(async () => {
  for await (const conn of listener) {
    const buf = new Uint8Array(4096)
    const n = await conn.read(buf)
    console.log('收到', n, '字节')
    conn.close()
  }
})()

// ── 客户端 ───────────────────────────────────────────────────────────────────
const client = new Utp()
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

await conn.write(new TextEncoder().encode('hello μTP'))
conn.close()

await client.close()
await server.close()
```

### API 参考

#### `Utp` 类

| 方法 | 说明 |
| ---- | ---- |
| `listen(options)` | 启动服务端，返回可异步迭代的 `UTPListener` |
| `connect(options)` | 连接远端，成功后返回 `UtpConn` |
| `close()` | 优雅关闭 socket 及所有连接 |
| `localAddr` | 已绑定的本地地址 |

#### `UtpConn` 类（实现 `Reader`、`Writer`、`Closer`）

| 方法 | 说明 |
| ---- | ---- |
| `read(buf)` | 读取数据；EOF 时返回 `null` |
| `write(data)` | 发送数据；连接已关闭时抛出异常 |
| `close()` | 发送 `ST_FIN`，发起优雅关闭 |

### 运行测试

```bash
deno test --allow-all --unstable-net
```

共 105 个测试，覆盖组件单元测试、协议正确性、大文件传输（45 MB 视频）及并发连接场景。

### 架构说明

```text
Utp（socket 层）
 ├─ UTPListener          — 入站连接接受队列
 ├─ UtpConn              — 连接状态机（CS_SYN_SENT → CS_CONNECTED → CS_CLOSED）
 │   ├─ BlockingBuffer   — 接收字节缓冲区（256 KB，流控感知）
 │   ├─ UtpSendWindow    — 在途包追踪，基于 BlockingMap 实现背压
 │   ├─ UtpRttTracker    — 平滑 RTT / RTO 估算
 │   └─ UtpCongestionControl  — LEDBAT 延迟算法
 └─ UtpPacket
     ├─ UtpSelectiveAckExtension  （类型 1，SACK）
     └─ UtpExtensionBits          （类型 2，能力协商）
```

### 参考规范

- [BEP 29 — uTorrent transport protocol](https://www.bittorrent.org/beps/bep_0029.html)
- [LEDBAT — RFC 6817](https://datatracker.ietf.org/doc/html/rfc6817)
