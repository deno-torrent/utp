import { assert, assertEquals } from 'std/assert/mod.ts'
import { crypto } from 'std/crypto/mod.ts'
import { encodeHex } from 'std/encoding/hex.ts'
import { Utp } from '../mod.ts'

async function sha256(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  return encodeHex(await crypto.subtle.digest('SHA-256', buf))
}

Deno.test('UTP传输测试 - 视频文件', async () => {
  const TEST_TIMEOUT_MS = 120_000 // 2 分钟安全上限
  let timeoutId: number

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`测试超时（超过 ${TEST_TIMEOUT_MS / 1000}s）`)),
      TEST_TIMEOUT_MS
    )
  })

  try {
    await Promise.race([runTest(), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }

  async function runTest() {
    const server = new Utp()
    const client = new Utp()

    try {
      const listener = server.listen({ port: 9093, hostname: '127.0.0.1' })

      const videoPath = new URL('../test/video.mp4', import.meta.url).pathname
      const testData = await Deno.readFile(videoPath)
      console.log(`视频文件大小: ${testData.length} 字节`)

      let receivedData: Uint8Array | null = null

      const serverPromise = (async () => {
        for await (const conn of listener) {
          const chunks: Uint8Array[] = []
          const buffer = new Uint8Array(8192)
          let totalReceived = 0

          while (true) {
            const n = await conn.read(buffer)
            if (n === null) break
            chunks.push(buffer.slice(0, n))
            totalReceived += n
            if (totalReceived >= testData.length) break
          }

          const result = new Uint8Array(totalReceived)
          let offset = 0
          for (const chunk of chunks) {
            result.set(chunk, offset)
            offset += chunk.length
          }
          receivedData = result

          await conn.close()
          break
        }
      })()

      const conn = await client.connect({ port: 9093, hostname: '127.0.0.1' })

      const chunkSize = 8 * 1024
      const startTime = Date.now()
      let totalSent = 0
      for (let i = 0; i < testData.length; i += chunkSize) {
        const chunk = testData.slice(i, Math.min(i + chunkSize, testData.length))
        totalSent += await conn.write(chunk)
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
      const speed = ((totalSent / (Date.now() - startTime)) * 1000 / (1024 * 1024)).toFixed(2)
      console.log(`发送完成: ${totalSent} 字节，耗时 ${elapsed}s，速度 ${speed} MB/s`)

      await conn.close()
      await serverPromise

      assert(receivedData !== null, '服务器应该收到数据')
      assertEquals((receivedData as Uint8Array).length, testData.length, '接收大小应等于发送大小')
      assertEquals(await sha256(receivedData as Uint8Array), await sha256(testData), '接收内容应与发送内容完全一致')
      console.log('数据验证通过')
    } finally {
      if (!client.isClosed()) await client.close()
      if (!server.isClosed()) await server.close()
    }
  }
})
