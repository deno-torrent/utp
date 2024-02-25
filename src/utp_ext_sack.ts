import { UtpConn } from './utp_conn.ts'
import { Extension, ExtensionType } from './utp_packet.ts'
import { BitArray } from 'toolkit/mod.ts'
import { Seq } from '@src/utilt.ts'

/**
 * 仅在接收流中至少有一个序列号被跳过时才发送选择性 ACK。
 * 因此，掩码中的第一个比特表示 ack_nr + 2。在发送此数据包时，假定 ack_nr + 1 已被删除或丢失。
 * 设置的比特(1)表示已接收的数据包，清除的比特(0)表示尚未接收的数据包。
 *
 * bitmask layout
 * first byte [ack+2...ack+2+7] is reverse order,second byte [ack+2+8...ack+2+15] is reverse order, and so on
 *
 * 0               8               16
 * +---------------+---------------+---------------+---------------+
 * | 9 8 ...   3 2 | 17   ...   10 | 25   ...   18 | 33   ...   26 |
 * +---------------+---------------+---------------+---------------+
 *
 */
export class UtpSelectiveAckExtension implements Extension {
  base: number // ack_nr
  type: ExtensionType
  // 位掩码,用于表示哪些包已收到,哪些没收到,第一位表示ack_nr+2,第二位表示ack_nr+2+1,第三位表示ack_nr+2+2,以此类推,1表示已接收,0表示未接收
  // bitmask的长度至少是32的倍数
  bitmask: Uint8Array

  private constructor(base: number, bitmask: Uint8Array) {
    this.base = base
    this.type = ExtensionType.SelectiveAcknowledgement
    this.bitmask = bitmask
  }

  /**
   * 从字节数组创建SACK扩展
   * @param bitmask
   * @returns
   */
  static createFromBytes(localAckNr: number, bitmask: Uint8Array): UtpSelectiveAckExtension {
    // bitmask单位是bit时,的长度至少是32的倍数,转换成字节，必须是4的倍数
    if (bitmask.length % (32 / 8) !== 0) {
      throw new Error(`bitmask length must be a multiple of 32, but got ${bitmask.length}`)
    }
    return new UtpSelectiveAckExtension(localAckNr, bitmask)
  }

  static createFromConn(conn: UtpConn): UtpSelectiveAckExtension | undefined {
    const ackNr = conn.localAckNr
    const recevRemoteSeqNrs = conn.recvPacketQueue.keys()

    return UtpSelectiveAckExtension.create(ackNr, recevRemoteSeqNrs)
  }

  /**
   * 创建SACK扩展
   * @param recvRemoteSeqNrs 已收到的数据包序列号,最小值必须大于等于ackNr+2
   * @returns SACK扩展
   */
  static create(localAckNr: number, recvRemoteSeqNrs: number[]): UtpSelectiveAckExtension | undefined {
//     console.log(`
// Creating SACK extension:
// - Local ackNr: ${localAckNr}
// - Received seqNrs: ${recvRemoteSeqNrs.join(', ')}`)

    // 移除条件限制，始终创建SACK
    if (recvRemoteSeqNrs.length === 0) {
      return undefined
    }

    const firstSeq = Seq.add(localAckNr, 2)
    // 按相对 firstSeq 的正向距离排序，正确处理回绕
    const seqNrs = recvRemoteSeqNrs.sort((a, b) => Seq.diff(a, firstSeq) - Seq.diff(b, firstSeq))
    const MIN_BITMASK_LENGTH = 4 // 最小字节长度,32位,4字节

    // 动态计算bitmask长度
    let bitmaskLength = MIN_BITMASK_LENGTH
    if (seqNrs.length > 0) {
      const lastSeq = seqNrs[seqNrs.length - 1]
      const totalLength = Seq.diff(lastSeq, firstSeq) + 1
      const bytesLength = Math.ceil(totalLength / 8)
      bitmaskLength = Math.max(MIN_BITMASK_LENGTH, Math.ceil(bytesLength / MIN_BITMASK_LENGTH) * MIN_BITMASK_LENGTH)
    }

    // 初始化bitmask
    const bitmask = new Uint8Array(bitmaskLength)

    // 从firstSeq开始设置bitmask
    for (const seqNr of seqNrs) {
      if (Seq.ge(seqNr, firstSeq)) {
        const bitIndex = Seq.diff(seqNr, firstSeq)
        if (bitIndex < bitmaskLength * 8) {
          const byteIndex = Math.floor(bitIndex / 8)
          const bitPosition = bitIndex % 8
          // 根据文档，位掩码布局是按照反序排列的
          // 对于第一个字节：[ack+2...ack+2+7]
          bitmask[byteIndex] |= (1 << bitPosition)
        }
      }
    }

//     console.log(`
// SACK extension created:
// - Base: ${localAckNr}
// - Bitmask length: ${bitmaskLength}
// - First seq: ${firstSeq}
// - Bitmask: ${bitmaskToBinaryString(bitmask)}`)

    return new UtpSelectiveAckExtension(localAckNr, bitmask)
  }

  // 位掩码转换成字节数组
  toBytes(): Uint8Array {
    return this.bitmask
  }

  // 根据位掩码获取丢包的序列号
  getRemoteNotReceivedSeqNrs(): number[] {
    const lostSeqNumbers: number[] = []
    let seqNr = Seq.add(this.base, 2)

    lostSeqNumbers.push(Seq.add(this.base, 1))

    for (let byteIndex = 0; byteIndex < this.bitmask.length; byteIndex++) {
      for (let bitOffset = 0; bitOffset <= 7; bitOffset++) {
        if ((this.bitmask[byteIndex] & (1 << bitOffset)) === 0) {
          lostSeqNumbers.push(seqNr)
        }
        seqNr = Seq.add(seqNr, 1)
      }
    }

    return lostSeqNumbers
  }

  // 根据位掩码获取已收到的序列号
  getRemoteReceivedSeqNrs(): number[] {
    const receivedSeqNumbers: number[] = []
    let seqNr = Seq.add(this.base, 2)

    for (let byteIndex = 0; byteIndex < this.bitmask.length; byteIndex++) {
      for (let bitOffset = 0; bitOffset <= 7; bitOffset++) {
        if ((this.bitmask[byteIndex] & (1 << bitOffset)) !== 0) {
          receivedSeqNumbers.push(seqNr)
        }
        seqNr = Seq.add(seqNr, 1)
      }
    }

    return receivedSeqNumbers
  }

  toString(): string {
    return `UtpSelectiveAckExtension{base: ${this.base}, bitmask: ${bitmaskToBinaryString(this.bitmask)}}`
  }
}

function bitmaskToBinaryString(bitmask: Uint8Array): string {
  return Array.from(bitmask)
    .map(byte => byte.toString(2).padStart(8, '0'))
    .join(' ')
}
