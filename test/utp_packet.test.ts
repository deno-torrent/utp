import { UtpPacket, UtpPacketType, ExtensionType } from '@src/utp_packet.ts'
import { UtpSelectiveAckExtension } from '@src/utp_ext_sack.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('UtpPacket fromBytes test', () => {
  const buffer = new Uint8Array([
    0x41, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00
  ])
  const packet = UtpPacket.fromBytes(buffer)
  assertEquals(packet.type, UtpPacketType.ST_SYN)
  assertEquals(packet.version, 1)
  assertEquals(packet.extension, 0)
  assertEquals(packet.connId, 1)
  assertEquals(packet.timestampMicroseconds, 0)
  assertEquals(packet.timestampDifferenceMicroseconds, 0)
  assertEquals(packet.windowSize, 0)
  assertEquals(packet.seqNr, 0)
  assertEquals(packet.ackNr, 0)
  assertEquals(packet.extensions.length, 0)
  assertEquals(packet.data, undefined)
  assertEquals(packet.needResend, false)
})

Deno.test('UtpPacket toBytes test', () => {
  const packet = new UtpPacket()
  packet.type = UtpPacketType.ST_DATA
  packet.version = 1
  packet.extension = 0
  packet.connId = 1234
  packet.timestampMicroseconds = 5678
  packet.timestampDifferenceMicroseconds = 123
  packet.windowSize = 456
  packet.seqNr = 789
  packet.ackNr = 987
  packet.data = new Uint8Array([1, 2, 3, 4])

  const expectedBuffer = new Uint8Array([
    1, 0, 4, 210, 0, 0, 22, 46, 0, 0, 0, 123, 0, 0, 1, 200, 3, 21, 3, 219, 1, 2, 3, 4
  ])

  const buffer = packet.toBytes()
  assertEquals(buffer, expectedBuffer)
})

Deno.test('UtpPacket length test', () => {
  const packet = new UtpPacket()
  packet.type = UtpPacketType.ST_DATA
  packet.version = 1
  packet.extension = 0
  packet.connId = 1234
  packet.timestampMicroseconds = 5678
  packet.timestampDifferenceMicroseconds = 123
  packet.windowSize = 456
  packet.seqNr = 789
  packet.ackNr = 987
  packet.data = new Uint8Array([1, 2, 3, 4])

  const expectedLength = 24

  const length = packet.length()
  assertEquals(length, expectedLength)
})

Deno.test('UtpPacket isPacket test', () => {
  let buffer = new Uint8Array([
    0x40, 0x00, 0x04, 0xd2, 0x00, 0x00, 0x16, 0x2e, 0x00, 0x00, 0x01, 0xc8, 0x00, 0x00, 0x03, 0x15, 0x00, 0x00, 0x03,
    0xdb, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04
  ])

  let isPacket = UtpPacket.isPacket(buffer)
  assertEquals(isPacket, false)

  buffer = new Uint8Array([1, 0, 4, 210, 0, 0, 22, 46, 0, 0, 0, 123, 0, 0, 1, 200, 3, 21, 3, 219, 1, 2, 3, 4])
  isPacket = UtpPacket.isPacket(buffer)
  assertEquals(isPacket, true)
})

// ─── 往返序列化测试 ──────────────────────────────────────────────────────────

Deno.test('UtpPacket toBytes → fromBytes 往返：无负载包', () => {
  const original = new UtpPacket()
  original.type = UtpPacketType.ST_STATE
  original.version = 1
  original.extension = 0
  original.connId = 999
  original.timestampMicroseconds = 123456
  original.timestampDifferenceMicroseconds = 789
  original.windowSize = 65535
  original.seqNr = 100
  original.ackNr = 200

  const restored = UtpPacket.fromBytes(original.toBytes())

  assertEquals(restored.type, original.type)
  assertEquals(restored.version, original.version)
  assertEquals(restored.connId, original.connId)
  assertEquals(restored.timestampMicroseconds, original.timestampMicroseconds)
  assertEquals(restored.timestampDifferenceMicroseconds, original.timestampDifferenceMicroseconds)
  assertEquals(restored.windowSize, original.windowSize)
  assertEquals(restored.seqNr, original.seqNr)
  assertEquals(restored.ackNr, original.ackNr)
  assertEquals(restored.data, undefined)
})

Deno.test('UtpPacket toBytes → fromBytes 往返：带 data 的 ST_DATA 包', () => {
  const original = new UtpPacket()
  original.type = UtpPacketType.ST_DATA
  original.version = 1
  original.extension = 0
  original.connId = 42
  original.timestampMicroseconds = 1000
  original.timestampDifferenceMicroseconds = 0
  original.windowSize = 4096
  original.seqNr = 7
  original.ackNr = 3
  original.data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF])

  const restored = UtpPacket.fromBytes(original.toBytes())

  assertEquals(restored.type, UtpPacketType.ST_DATA)
  assertEquals(restored.seqNr, 7)
  assertEquals(restored.ackNr, 3)
  assertEquals(restored.data, original.data)
})

Deno.test('UtpPacket toBytes → fromBytes 往返：带 SACK 扩展的包', () => {
  const sack = UtpSelectiveAckExtension.create(5, [7, 9])!
  const original = new UtpPacket()
  original.type = UtpPacketType.ST_STATE
  original.version = 1
  original.extension = ExtensionType.SelectiveAcknowledgement
  original.connId = 100
  original.timestampMicroseconds = 500
  original.timestampDifferenceMicroseconds = 10
  original.windowSize = 1024
  original.seqNr = 1
  original.ackNr = 5
  original.extensions.push(sack)

  const bytes = original.toBytes()
  const restored = UtpPacket.fromBytes(bytes)

  assertEquals(restored.type, UtpPacketType.ST_STATE)
  assertEquals(restored.ackNr, 5)
  assertEquals(restored.extensions.length, 1)
  assertEquals(restored.extensions[0].type, ExtensionType.SelectiveAcknowledgement)
  // 验证 SACK bitmask 一致
  const restoredSack = restored.sackExtension!
  assertEquals(restoredSack.bitmask, sack.bitmask)
  assertEquals(restoredSack.getRemoteReceivedSeqNrs(), [7, 9])
})
