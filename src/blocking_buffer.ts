import { assert } from 'std/assert/assert.ts'
import { Buffer } from 'std/io/buffer.ts'
// 用于处理缓冲区操作，实现了写入和读取的同步处理
export class BlockingBuffer {
  private totalBytesWritten: number // 写入的总字节数
  private totalBytesRead: number // 读取的总字节数
  private buffer: Buffer
  // 函数数组，存储着读操作的解析函数（当写入数据时将调用这些函数）
  private readResolvers: { resolve: (value: number | null) => void; reject: (reason?: unknown) => void; buf: Uint8Array }[]
  // 缓冲区是否关闭的标志
  private closed: boolean = false
  // 标记不再有新数据写入（收到远端 FIN 后），但现有数据仍可读取
  private closedForWriting: boolean = false
  // 接收缓冲区最大字节数（用于向发送方广播剩余接收窗口）
  readonly maxBytes: number

  constructor(maxBytes: number = 256 * 1024) {
    // 构造函数中初始化 buffer 和 readResolvers
    this.buffer = new Buffer()
    this.readResolvers = []
    this.totalBytesWritten = 0
    this.totalBytesRead = 0
    this.maxBytes = maxBytes
  }

  get totalWritten(): number {
    return this.totalBytesWritten
  }

  get totalRead(): number {
    return this.totalBytesRead
  }

  // 获取缓冲区的剩余空间（相对于固定上限 maxBytes，用于广播接收窗口）
  get freeSpace(): number {
    return Math.max(0, this.maxBytes - this.buffer.length)
  }

  // 缓冲区中的数据长度
  get length(): number {
    return this.buffer.length
  }

  // write 方法为异步，用于向缓冲区写入数据，返回写入的字节数
  async write(data: Uint8Array): Promise<number> {
    // 将数据写入内部 Buffer 实例
    const n = await this.buffer.write(data)

    // 更新写入的总字节数
    this.totalBytesWritten += n

    // console.log(`总共写入 ${this.totalBytesWritten} 字节`)
    // console.log(`已写入 ${n} 字节,总共写入 ${this.totalBytesWritten} 字节`)
    // 循环遍历 readResolvers 数组，如果有等待的读取操作且缓冲区有数据，则解析它们
    while (this.readResolvers.length > 0 && this.length > 0) {
      // 从 readResolvers 队列中取出待解析的对象
      const { resolve, buf } = this.readResolvers.shift()!
      // 确保使用等待中的读取操作提供的 Uint8Array 实例
      const readBytes = await this.buffer.read(buf)
      if (readBytes !== null) {
        this.totalBytesRead += readBytes
      }
      // console.log(`总共读取 ${this.totalBytesRead} 字节`)
      resolve(readBytes)
    }

    return n
  }

  // 异步读方法，从内部 Buffer 中读取数据
  async read(buf: Uint8Array): Promise<number | null> {
    // 如果缓冲区已关闭，立即返回 null
    if (this.closed) {
      assert(this.readResolvers.length === 0)
      assert(this.length === 0)
      return null
    }
    // 如果缓冲区中有数据，直接读取并返回读取的字节
    if (this.length > 0) {
      const n = await this.buffer.read(buf)
      if (n !== null) {
        this.totalBytesRead += n
      }
      // console.log(`总共读取 ${this.totalBytesRead} 字节`)
      return n
    } else {
      // 缓冲区为空：如果已收到 FIN（不再有新数据），返回 null（EOF）
      if (this.closedForWriting) {
        this.closed = true
        return null
      }
      // 如果缓冲区为空，则返回一个新的 Promise
      return new Promise<number | null>((resolve, reject) => {
        // 将解析和拒绝函数添加到 readResolvers 数组中
        this.readResolvers.push({ resolve, reject, buf })
      })
    }
  }

  // 软关闭：标记不再有新数据写入（收到远端 FIN）。
  // 现有缓冲数据仍可读取；缓冲区耗尽后 read() 自动返回 null。
  drain(): void {
    if (this.closed || this.closedForWriting) return
    this.closedForWriting = true
    // 若缓冲区已空，立即唤醒所有挂起的 read（返回 null）并标记完全关闭
    if (this.length === 0) {
      this.closed = true
      for (const { resolve } of this.readResolvers) {
        resolve(null)
      }
      this.readResolvers = []
    }
  }

  // 关闭缓冲区：清空数据并唤醒所有挂起的 read（返回 null）
  close(): void {
    this.closed = true
    this.buffer = new Buffer()
    for (const { resolve } of this.readResolvers) {
      resolve(null)
    }
    this.readResolvers = []
  }

  isEmpty(): boolean {
    return this.length === 0
  }

  canSafelyClose(): boolean {
    return this.isEmpty() && this.readResolvers.length === 0 && !this.closed
  }

  trySafeClose(): boolean {
    if (this.closed) return false
    if (this.canSafelyClose()) {
      this.close()
      return true
    }
    return false
  }
}
