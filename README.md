# μTP — Micro Transport Protocol

A TypeScript implementation of the [μTP (Micro Transport Protocol)](https://www.bittorrent.org/beps/bep_0029.html) for [Deno](https://deno.land), based on BEP 29.

---

## English

### Installation

```typescript
import { Utp } from 'jsr:@deno-torrent/utp'
```

### Quick Start

```typescript
import { Utp } from 'jsr:@deno-torrent/utp'

// ── Server ──────────────────────────────────────────────────────────────────
const server = new Utp()
const listener = server.listen({ port: 9000 })

;(async () => {
  for await (const conn of listener) {
    const buf = new Uint8Array(4096)
    const n = await conn.read(buf)
    console.log('received:', n, 'bytes')
    await conn.close()
  }
})()

// ── Client ──────────────────────────────────────────────────────────────────
const client = new Utp()
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

await conn.write(new TextEncoder().encode('hello μTP'))
await conn.close()

await client.close()
await server.close()
```

### API

#### `Utp`

| Member | Description |
| ------ | ----------- |
| `new Utp(tag?)` | Create a socket; optional `tag` label for logging |
| `listen(options)` | Start a server and return an async-iterable `UTPListener` |
| `connect(options)` | Dial a remote peer; resolves to a `UtpConn` on success (5 s timeout) |
| `close()` | Gracefully close the socket and all active connections |
| `localAddr` | Bound local address (`undefined` before first listen/connect) |
| `enableLogging()` | Enable verbose debug logging |
| `disableLogging()` | Disable logging |

#### `UTPListener`

| Member | Description |
| ------ | ----------- |
| `for await (conn of listener)` | Async-iterate incoming connections |
| `accept()` | Accept the next connection manually |
| `close()` | Stop the listener and close all connections |

#### `UtpConn` (implements `Reader`, `Writer`, `Closer`)

| Member | Description |
| ------ | ----------- |
| `read(buf)` | Read incoming data; returns `null` on EOF |
| `write(data)` | Send data; throws if the connection is closed |
| `close()` | Initiate graceful close (`ST_FIN`), waits up to 10 s |
| `remoteAddr` | Remote peer address |
| `isConnected()` | Whether the connection is established |
| `isClosed()` | Whether the connection is closed |
| `averageWriteSpeed` | Average send speed in bytes/s |
| `averageReadSpeed` | Average receive speed in bytes/s |

### Running Tests

```bash
deno test --allow-all --unstable-net
```

---

## 中文

### 安装

```typescript
import { Utp } from 'jsr:@deno-torrent/utp'
```

### 快速开始

```typescript
import { Utp } from 'jsr:@deno-torrent/utp'

// ── 服务端 ───────────────────────────────────────────────────────────────────
const server = new Utp()
const listener = server.listen({ port: 9000 })

;(async () => {
  for await (const conn of listener) {
    const buf = new Uint8Array(4096)
    const n = await conn.read(buf)
    console.log('收到', n, '字节')
    await conn.close()
  }
})()

// ── 客户端 ───────────────────────────────────────────────────────────────────
const client = new Utp()
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

await conn.write(new TextEncoder().encode('hello μTP'))
await conn.close()

await client.close()
await server.close()
```

### 使用方式

#### 循环读取直到 EOF

`read()` 在对端发送完所有数据并调用 `close()` 后会返回 `null`，可借此读完全部数据：

```typescript
async function readAll(conn: UtpConn): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const buf = new Uint8Array(4096)

  while (true) {
    const n = await conn.read(buf)
    if (n === null) break        // EOF：对端已关闭
    chunks.push(buf.slice(0, n))
  }

  // 拼接所有片段
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// 服务端完整接收示例
const server = new Utp()
const listener = server.listen({ port: 9000 })

;(async () => {
  for await (const conn of listener) {
    const data = await readAll(conn)
    console.log('收到全部数据，共', data.length, '字节')
    await conn.close()
  }
})()
```

#### 发送大文件

`write()` 内部会自动按 MTU（1400 字节）分片，调用方无需手动分包，直接传入完整 `Uint8Array` 即可：

```typescript
const client = new Utp()
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

const fileBytes = await Deno.readFile('./video.mp4')
await conn.write(fileBytes)   // 自动分片发送
await conn.close()
await client.close()
```

#### 回显服务器（Echo Server）

```typescript
const server = new Utp()
const listener = server.listen({ port: 9000 })

for await (const conn of listener) {
  // 每个连接独立处理
  ;(async () => {
    const buf = new Uint8Array(4096)
    while (true) {
      const n = await conn.read(buf)
      if (n === null) break
      await conn.write(buf.slice(0, n))   // 原样回写
    }
    await conn.close()
  })()
}
```

#### 错误处理

```typescript
const client = new Utp()

try {
  // connect 连接超时为 5 秒
  const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

  try {
    await conn.write(new TextEncoder().encode('hello'))
    await conn.close()
  } catch (err) {
    console.error('传输失败:', err)
    // write() 在连接已关闭时会抛出异常
  }
} catch (err) {
  console.error('连接失败:', err)
  // 可能原因：目标不可达、5 秒内未收到 SYN-ACK、对端 RST
} finally {
  await client.close()
}
```

#### 查看传输速度统计

`UtpConn` 内置了发送/接收速度统计，可在传输结束后读取：

```typescript
const conn = await client.connect({ hostname: '127.0.0.1', port: 9000 })

const data = new Uint8Array(10 * 1024 * 1024) // 10 MB
await conn.write(data)
await conn.close()

console.log('平均发送速度:', conn.averageWriteSpeed, 'bytes/s')
console.log('最大发送速度:', conn.maxWriteSpeed, 'bytes/s')
console.log('最小发送速度:', conn.minWriteSpeed, 'bytes/s')
```

#### 开启调试日志

```typescript
const utp = new Utp('my-node')   // tag 会出现在日志前缀中
utp.enableLogging()

const conn = await utp.connect({ hostname: '127.0.0.1', port: 9000 })
// 之后所有收发包、状态变更均会打印到控制台

utp.disableLogging()   // 关闭日志
```

#### 监听指定网卡

`listen()` 和 `connect()` 默认绑定 `0.0.0.0`，可通过 `hostname` 限定网卡：

```typescript
// 仅监听本地回环
const server = new Utp()
server.listen({ port: 9000, hostname: '127.0.0.1' })

// 监听指定网卡 IP
server.listen({ port: 9000, hostname: '192.168.1.100' })
```

### API 参考

#### `Utp` 类

| 成员 | 说明 |
| ---- | ---- |
| `new Utp(tag?)` | 创建 socket，可选 `tag` 标签，用于区分日志输出 |
| `listen({ port, hostname? })` | 启动服务端，绑定端口并返回可异步迭代的 `UTPListener` |
| `connect({ port, hostname })` | 连接远端，5 秒内未握手成功则抛出超时异常，成功返回 `UtpConn` |
| `close()` | 优雅关闭 socket：先关闭 listener，再依次发送 FIN 关闭所有连接 |
| `localAddr` | 已绑定的本地地址，listen/connect 之前为 `undefined` |
| `enableLogging()` | 开启详细调试日志 |
| `disableLogging()` | 关闭日志（默认关闭） |

#### `UTPListener` 类

| 成员 | 说明 |
| ---- | ---- |
| `for await (conn of listener)` | 异步迭代，每次 `yield` 一个新建立的 `UtpConn` |
| `accept()` | 手动接受下一个连接，返回 `Promise<UtpConn>` |
| `close()` | 停止监听并关闭所有已接受的连接 |

#### `UtpConn` 类（实现 `Reader`、`Writer`、`Closer`）

| 成员 | 说明 |
| ---- | ---- |
| `read(buf)` | 读取数据到 `buf`，返回实际读取字节数；EOF 时返回 `null` |
| `write(data)` | 发送数据，自动按 MTU 分片；连接已关闭时抛出异常 |
| `close()` | 发送 `ST_FIN` 发起优雅关闭，最多等待 10 秒完成四次挥手 |
| `remoteAddr` | 对端地址（`{ hostname, port }`） |
| `isConnected()` | 是否处于已连接状态 |
| `isClosed()` | 是否已关闭 |
| `averageWriteSpeed` | 平均发送速度（bytes/s） |
| `maxWriteSpeed` | 最大发送速度（bytes/s） |
| `minWriteSpeed` | 最小发送速度（bytes/s） |
| `averageReadSpeed` | 平均接收速度（bytes/s） |
| `maxReadSpeed` | 最大接收速度（bytes/s） |
| `minReadSpeed` | 最小接收速度（bytes/s） |

### 行为说明

| 项目 | 值 |
| ---- | -- |
| 连接超时 | 5 秒（SYN 发出后未收到 SYN-ACK） |
| 关闭超时 | 10 秒（FIN 发出后未完成四次挥手则强制关闭） |
| Keep-alive 间隔 | 29 秒（与 libutp 一致） |
| MTU | 1400 字节（Deno 不支持 MTU 探测，固定值） |
| 传输层 | UDP（`Deno.listenDatagram`） |

### 运行测试

```bash
deno task test
# 或
deno test --allow-all --unstable-net
```
