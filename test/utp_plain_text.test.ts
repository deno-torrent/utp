import { assert, assertEquals } from 'std/assert/mod.ts'
import { Utp } from '../mod.ts'

Deno.test('UTP传输测试 - 简单文本', async () => {
  const server = new Utp()
  const client = new Utp()

  try {
    const listener = server.listen({
      port: 9090,
      hostname: '127.0.0.1'
    })

    const testData = new TextEncoder().encode('Hello, UTP!')
    let receivedData: Uint8Array | null = null

    const serverPromise = (async () => {
      for await (const conn of listener) {
        console.log('服务器收到连接')
        const buffer = new Uint8Array(1024)
        const n = await conn.read(buffer)
        if (n === null) break
        receivedData = buffer.slice(0, n)
        console.log('服务器收到数据:', new TextDecoder().decode(receivedData))
        await conn.close()
        break
      }
    })()

    console.log('客户端开始连接')
    const conn = await client.connect({
      port: 9090,
      hostname: '127.0.0.1'
    })
    console.log('客户端连接成功')

    const written = await conn.write(testData)
    console.log('客户端发送数据大小:', written)
    assertEquals(written, testData.length, '发送的数据大小应该等于原始数据大小')

    await serverPromise

    assert(receivedData !== null, '服务器应该收到数据')
    const received = receivedData as Uint8Array
    assertEquals(received.length, testData.length, '接收的数据大小应该等于发送的数据大小')
    assertEquals(
      new TextDecoder().decode(received),
      new TextDecoder().decode(testData),
      '接收的数据内容应该等于发送的数据内容'
    )

    if (!conn.isClosed()) await conn.close()
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  } catch (error) {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
    throw error
  }
})

Deno.test('UTP传输测试 - 大数据量', async () => {
  const server = new Utp()
  const client = new Utp()

  try {
    const listener = server.listen({ port: 9091, hostname: '127.0.0.1' })

    // 32KB 随机数据，远超接收队列默认大小
    const dataSize = 32 * 1024
    const testData = new Uint8Array(dataSize)
    crypto.getRandomValues(testData)

    const receivedBuffer = new Uint8Array(dataSize)
    let totalReceived = 0

    const serverPromise = (async () => {
      for await (const conn of listener) {
        while (true) {
          const buf = new Uint8Array(4096)
          const n = await conn.read(buf)
          if (n === null) break
          receivedBuffer.set(buf.slice(0, n), totalReceived)
          totalReceived += n
          if (totalReceived >= dataSize) break
        }
        await conn.close()
        break
      }
    })()

    const conn = await client.connect({ port: 9091, hostname: '127.0.0.1' })
    const written = await conn.write(testData)
    assertEquals(written, testData.length, '发送字节数应等于原始数据大小')

    await serverPromise

    assertEquals(totalReceived, dataSize, '接收字节数应等于发送字节数')
    assertEquals(receivedBuffer, testData, '接收内容应与发送内容完全一致')

    if (!conn.isClosed()) await conn.close()
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
  } catch (error) {
    if (!client.isClosed()) await client.close()
    if (!server.isClosed()) await server.close()
    throw error
  }
})