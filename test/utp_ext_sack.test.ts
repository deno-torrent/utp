import { UtpSelectiveAckExtension } from '@src/utp_ext_sack.ts'
import { assertEquals, assertExists } from 'std/assert/mod.ts'

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function bitmaskToBinaryString(bitmask: Uint8Array): string {
  return Array.from(bitmask)
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join(' ')
}

// ─── create() —— bitmask 生成 ────────────────────────────────────────────────

Deno.test('SACK create: [3,5] → bitmask 第0位和第2位置1', () => {
  // ackNr=1, firstSeq=ackNr+2=3
  // seqNr=3 → bitIndex=0 → bit0; seqNr=5 → bitIndex=2 → bit2
  const sack = UtpSelectiveAckExtension.create(1, [3, 5])
  assertExists(sack)
  const expected = new Uint8Array([0b00000101, 0, 0, 0])
  console.log('expect:', bitmaskToBinaryString(expected))
  console.log('actual:', bitmaskToBinaryString(sack!.bitmask))
  assertEquals(sack!.bitmask, expected)
})

Deno.test('SACK create: 跨字节的多个序列号', () => {
  // ackNr=1, firstSeq=3
  // 3→bit0, 5→bit2, 10→bit8(byte1 bit0), 11→bit9(byte1 bit1), 20→bit18(byte2 bit2), 21→bit19(byte2 bit3)
  const sack = UtpSelectiveAckExtension.create(1, [3, 5, 10, 11, 20, 21])
  assertExists(sack)
  const expected = new Uint8Array([0b10000101, 0b00000001, 0b00000110, 0])
  console.log('expect:', bitmaskToBinaryString(expected))
  console.log('actual:', bitmaskToBinaryString(sack!.bitmask))
  assertEquals(sack!.bitmask, expected)
})

Deno.test('SACK create: 包含第28个序列号需要第4字节', () => {
  // seqNr=28 → bitIndex=25 → byte3 bit1
  const sack = UtpSelectiveAckExtension.create(1, [3, 5, 10, 11, 20, 21, 28])
  assertExists(sack)
  const expected = new Uint8Array([0b10000101, 0b00000001, 0b00000110, 0b00000010])
  console.log('expect:', bitmaskToBinaryString(expected))
  console.log('actual:', bitmaskToBinaryString(sack!.bitmask))
  assertEquals(sack!.bitmask, expected)
})

Deno.test('SACK create: 空序列号列表返回 undefined', () => {
  const sack = UtpSelectiveAckExtension.create(5, [])
  assertEquals(sack, undefined)
})

// ─── getRemoteReceivedSeqNrs() —— 读回已收到的序列号 ─────────────────────────

Deno.test('SACK getRemoteReceivedSeqNrs: 基本场景 [3,5]', () => {
  const sack = UtpSelectiveAckExtension.create(1, [3, 5])!
  const received = sack.getRemoteReceivedSeqNrs()
  assertEquals(received, [3, 5], '应返回 [3, 5]')
})

Deno.test('SACK getRemoteReceivedSeqNrs: 跨字节场景', () => {
  const seqNrs = [3, 5, 10, 11, 20, 21]
  const sack = UtpSelectiveAckExtension.create(1, seqNrs)!
  const received = sack.getRemoteReceivedSeqNrs()
  assertEquals(received, seqNrs)
})

Deno.test('SACK round-trip: create → getRemoteReceivedSeqNrs 完整往返', () => {
  const ackNr = 10
  const input = [12, 14, 18, 19, 25]
  const sack = UtpSelectiveAckExtension.create(ackNr, input)!
  const output = sack.getRemoteReceivedSeqNrs()
  // 只要包含所有 input 序列号即可（bitmask 可能覆盖更多位）
  for (const seq of input) {
    assertEquals(output.includes(seq), true, `应包含 seqNr=${seq}`)
  }
  // 确保 input 之外的序列号不在 output 中
  for (const seq of output) {
    assertEquals(input.includes(seq), true, `不应包含 seqNr=${seq}`)
  }
})

// ─── getRemoteNotReceivedSeqNrs() —— 确认丢失的序列号 ───────────────────────

Deno.test('SACK getRemoteNotReceivedSeqNrs: ack+1 始终在丢失列表中', () => {
  const ackNr = 5
  // 收到了 7, 9，ackNr+1=6 没收到
  const sack = UtpSelectiveAckExtension.create(ackNr, [7, 9])!
  const lost = sack.getRemoteNotReceivedSeqNrs()
  assertEquals(lost.includes(6), true, 'ackNr+1=6 应该在丢失列表中')
})

Deno.test('SACK getRemoteNotReceivedSeqNrs: 未置位的序列号在丢失列表中', () => {
  const ackNr = 1
  // 收到了 3, 5；4 没收到
  const sack = UtpSelectiveAckExtension.create(ackNr, [3, 5])!
  const lost = sack.getRemoteNotReceivedSeqNrs()
  assertEquals(lost.includes(2), true, 'ackNr+1=2 应在丢失列表')
  assertEquals(lost.includes(4), true, '4 应在丢失列表（未收到）')
  assertEquals(lost.includes(3), false, '3 已收到，不应在丢失列表')
  assertEquals(lost.includes(5), false, '5 已收到，不应在丢失列表')
})

// ─── createFromBytes() —— 反序列化 ──────────────────────────────────────────

Deno.test('SACK createFromBytes: 4字节对齐要求', () => {
  // 3字节不满足4字节对齐，应抛出异常
  let threw = false
  try {
    UtpSelectiveAckExtension.createFromBytes(1, new Uint8Array([0b00000101, 0, 0]))
  } catch (_) {
    threw = true
  }
  assertEquals(threw, true, '3字节 bitmask 应抛出错误')
})

Deno.test('SACK createFromBytes: bitmask 序列化往返一致', () => {
  const original = UtpSelectiveAckExtension.create(1, [3, 5, 10])!
  const restored = UtpSelectiveAckExtension.createFromBytes(1, original.toBytes())
  assertEquals(restored.bitmask, original.bitmask)
  assertEquals(restored.base, original.base)
})
