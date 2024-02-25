import { Extension, ExtensionType } from './utp_packet.ts'

/**
 * BEP 29 Extension Bits（类型 2）
 *
 * 8 字节（64 位）能力协商位，随连接握手包发送，用于双方协商扩展能力。
 * 目前所有位均为 0，表示无额外能力；解析时保留对端的位以备未来使用。
 *
 * 位掩码布局（暂未分配，全部保留）：
 *   byte 0 bit 0 … byte 7 bit 7 均为保留位
 */
export class UtpExtensionBits implements Extension {
  readonly type = ExtensionType.ExtensionBits
  /** 8 字节能力位，0 表示不支持该能力 */
  readonly bits: Uint8Array

  static readonly BITS_LENGTH = 8 // 固定 8 字节

  private constructor(bits: Uint8Array) {
    this.bits = bits
  }

  /** 创建全零的 Extension Bits（本端不声明任何能力） */
  static create(): UtpExtensionBits {
    return new UtpExtensionBits(new Uint8Array(UtpExtensionBits.BITS_LENGTH))
  }

  /** 从网络字节流解析 Extension Bits */
  static createFromBytes(payload: Uint8Array): UtpExtensionBits {
    if (payload.length !== UtpExtensionBits.BITS_LENGTH) {
      throw new Error(
        `Extension Bits payload must be ${UtpExtensionBits.BITS_LENGTH} bytes, got ${payload.length}`
      )
    }
    return new UtpExtensionBits(new Uint8Array(payload))
  }

  toBytes(): Uint8Array {
    return this.bits
  }

  toString(): string {
    const hex = Array.from(this.bits)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `ExtensionBits{0x${hex}}`
  }
}
