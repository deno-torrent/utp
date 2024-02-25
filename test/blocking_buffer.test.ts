import { BlockingBuffer } from '../src/blocking_buffer.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('BlockingBuffer basic write and read test', async () => {
  const buffer = new BlockingBuffer()
  const testData = new Uint8Array([1, 2, 3, 4, 5])
  const readBuffer = new Uint8Array(5)

  // 写入测试数据
  const written = await buffer.write(testData)
  assertEquals(written, 5)
  assertEquals(buffer.totalWritten, 5)
  assertEquals(buffer.length, 5)

  // 读取测试数据
  const read = await buffer.read(readBuffer)
  assertEquals(read, 5)
  assertEquals(buffer.totalRead, 5)
  assertEquals(buffer.length, 0)
  assertEquals(readBuffer, testData)
})

Deno.test('BlockingBuffer empty test', async () => {
  const buffer = new BlockingBuffer()
  assertEquals(buffer.isEmpty(), true)
  assertEquals(buffer.length, 0)
  assertEquals(buffer.freeSpace, buffer.maxBytes) // 空缓冲区剩余空间等于最大容量
})

Deno.test('BlockingBuffer close test', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer = new Uint8Array(5)

  // 写入一些数据
  await buffer.write(new Uint8Array([1, 2, 3]))

  // 正常关闭
  buffer.close()
  assertEquals(buffer.isEmpty(), true)
  
  // 尝试读取已关闭的缓冲区
  const read = await buffer.read(readBuffer)
  assertEquals(read, null)
})

Deno.test('BlockingBuffer safe close test', async () => {
  const buffer = new BlockingBuffer()
  
  // 空缓冲区可以安全关闭
  assertEquals(buffer.canSafelyClose(), true)
  assertEquals(buffer.trySafeClose(), true)

  // 写入数据后不能安全关闭
  await buffer.write(new Uint8Array([1, 2, 3]))
  assertEquals(buffer.canSafelyClose(), false)
  assertEquals(buffer.trySafeClose(), false)
})

Deno.test('BlockingBuffer force close test', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer = new Uint8Array(5)

  await buffer.write(new Uint8Array([1, 2, 3]))
  assertEquals(buffer.length, 3)

  buffer.close()
  assertEquals(buffer.length, 0)
  assertEquals(buffer.isEmpty(), true)

  const read = await buffer.read(readBuffer)
  assertEquals(read, null)
})

Deno.test('BlockingBuffer multiple reads test', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer1 = new Uint8Array(2)
  const readBuffer2 = new Uint8Array(3)

  // 写入数据
  await buffer.write(new Uint8Array([1, 2, 3, 4, 5]))

  // 分两次读取
  const read1 = await buffer.read(readBuffer1)
  assertEquals(read1, 2)
  assertEquals(readBuffer1, new Uint8Array([1, 2]))

  const read2 = await buffer.read(readBuffer2)
  assertEquals(read2, 3)
  assertEquals(readBuffer2, new Uint8Array([3, 4, 5]))
})

Deno.test('BlockingBuffer 阻塞读：缓冲区空时 read 应等待 write 到来', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer = new Uint8Array(5)

  // 先发起 read（此时缓冲区为空，会阻塞）
  const readPromise = buffer.read(readBuffer)

  // 异步写入（给 read 解锁）
  await buffer.write(new Uint8Array([10, 20, 30]))

  const n = await readPromise
  assertEquals(n, 3)
  assertEquals(readBuffer.slice(0, 3), new Uint8Array([10, 20, 30]))
})

Deno.test('BlockingBuffer close 应解除挂起的 read 并返回 null（有数据时）', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer = new Uint8Array(5)

  const readPromise = buffer.read(readBuffer)

  buffer.close()

  const n = await readPromise
  assertEquals(n, null, 'close 后挂起的 read 应返回 null')
})

Deno.test('BlockingBuffer close 应解除挂起的 read 并返回 null', async () => {
  const buffer = new BlockingBuffer()
  const readBuffer = new Uint8Array(5)

  // 先发起 read（缓冲区为空，会阻塞）
  const readPromise = buffer.read(readBuffer)

  // 关闭，挂起的 read 应立即返回 null
  buffer.close()

  const n = await readPromise
  assertEquals(n, null, 'close 后挂起的 read 应返回 null')
})