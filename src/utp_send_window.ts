import { BlockingMap } from '@src/blocking_map.ts'
import { UtpAddr } from '@src/utp_addr.ts'
import { UtpCongestionControl } from '@src/utp_congestion_control.ts'
import { UtpConn, UtpPacketWithAddr } from '@src/utp_conn.ts'
import { UtpSelectiveAckExtension } from '@src/utp_ext_sack.ts'
import { UtpPacket } from '@src/utp_packet.ts'
import { UtpRttTracker } from '@src/utp_rtt_tracker.ts'
import { Logger } from '@src/logger.ts'
import { UtpContext } from '@src/utp_context.ts'
import { Seq } from '@src/utilt.ts'

export type UtpPacketWithExtraInfo = {
  packet: UtpPacket // UTP包
  resendTimes: number // 重传次数
  ackCount: number // 收到的ACK次数
  sentTime: number // 发送时间
  remoteAddr: UtpAddr
}

/**
 * Send window
 */
export class UtpSendWindow {
  // #DEFAULT_WINDOW_SIZE = 256 * 1024 // 256KB, the default window size
  #RESEND_TIMES_LIMIT = 3 // the resend times limit for a packet
  #SACK_MAX_SEND_PACKET_COUNT = 128 // SACK扩展中最大发送的包数量
  #MAX_WINDOW_SIZE = 64 // 最大窗口大小（包数量），限制在途包数，防止 OS UDP 缓冲区溢出
  #MIN_WINDOW_SIZE = 4 // packet count, the minimum window size

  #packetMap: BlockingMap<number, UtpPacketWithExtraInfo>
  #ackCounter: Map<number, number> // <ackNr,received times> // 用于记录不同的ackNr收到的次数
  #maxWindow: number // the maximum window size, unit is packet count
  #minWindow: number // the minimum window size, unit is packet count
  #conn: UtpConn
  #sackExtension: UtpSelectiveAckExtension | undefined // SACK扩展
  #latestSeqReceivedOfOtherSide?: number // the ack number of other side,这里的ackNr是指对方收到的最大的包的序列号
  #congestionControl: UtpCongestionControl // 拥塞控制
  #rttTracker: UtpRttTracker // RTT跟踪器
  #totalAckedPackets = 0 // 总共确认的包的数量
  #remoteWindowBytes?: number // 对端广播的接收窗口大小（字节），undefined 表示尚未收到 ACK
  logger: Logger

  constructor(conn: UtpConn) {
    this.#ackCounter = new Map<number, number>()
    this.#packetMap = new BlockingMap<number, UtpPacketWithExtraInfo>(this.#MIN_WINDOW_SIZE)
    this.#congestionControl = new UtpCongestionControl(this.#MIN_WINDOW_SIZE)
    this.#maxWindow = this.#MAX_WINDOW_SIZE
    this.#minWindow = this.#MIN_WINDOW_SIZE
    this.#rttTracker = new UtpRttTracker()
    this.#conn = conn
    this.logger = UtpContext.getInstance().getLogger(`SEND_WINDOW_${conn.uniqueId()}`)
  }

  /**
   * 只要lastAck>=seqNr，就认为seqNr包已确认
   * @param seqNr
   * @returns
   */
  private isPacketAcked(seqNr: number): boolean {
    return (
      this.#latestSeqReceivedOfOtherSide !== undefined &&
      Seq.ge(this.#latestSeqReceivedOfOtherSide, seqNr)
    )
  }

  /**
   * 重传超时的数据包
   */
  async resend() {
    const now = Date.now()
    const seqNrs = this.getAllSeqNrs()
    for (const seqNr of seqNrs) {
      const packetWithExtraInfo = this.#packetMap.get(seqNr)
      if (packetWithExtraInfo) {
        const rto = this.#rttTracker.rto
        if (now - packetWithExtraInfo.sentTime > rto) {
          if (packetWithExtraInfo.resendTimes >= this.#RESEND_TIMES_LIMIT) {
            // 重传次数超过限制，视为丢包
            this.#congestionControl.onPacketLoss()
            this.#applyWindowSize()
            this.#packetMap.delete(seqNr)
            this.logger.debug(`packet seq${packetWithExtraInfo.packet.seqNr} is lost`)
            continue
          }
          // 重传数据包
          packetWithExtraInfo.resendTimes++
          packetWithExtraInfo.sentTime = now
          await this.#conn.utp.sendUtpPacket(packetWithExtraInfo.packet, packetWithExtraInfo.remoteAddr)
        }
      }
    }
  }

  /**
   * 将拥塞控制计算出的窗口大小与对端接收窗口共同约束发送容量
   */
  #applyWindowSize(): void {
    const ccWindow = Math.max(this.#minWindow, Math.min(this.#maxWindow, this.#congestionControl.getWindowSize()))
    let size = ccWindow
    // 同时尊重对端广播的接收窗口（避免溢出对端接收缓冲区）
    if (this.#remoteWindowBytes !== undefined) {
      const mtu = this.#conn.getMaxPacketSize()
      const remoteWindowPackets = Math.max(1, Math.floor(this.#remoteWindowBytes / mtu))
      size = Math.min(ccWindow, remoteWindowPackets)
    }
    this.#packetMap.updateCapacity(size)
    this.logger.debug(`SendWindow: window capacity updated to ${size} (cc=${ccWindow}, remoteBytes=${this.#remoteWindowBytes ?? 'unknown'})`)
  }

  /**
   * 检查超时的数据包
   */
  async timeoutCheck() {
    await this.resend()
  }

  /**
   * 将数据包登记到发送窗口并等待窗口有空间（若窗口已满则阻塞）
   * 实际发送由调用方（conn.sendUtpPacket）负责，避免重复发送
   * @param packetWithAddr
   */
  async waitForAck(packetWithAddr: UtpPacketWithAddr): Promise<void> {
    const packet = packetWithAddr.packet
    const seqNr = packet.seqNr
    this.logger.debug(`SendWindow.waitForAck seqNr=${packet.seqNr}`)

    // 将数据包放入发送窗口，若窗口已满则在此阻塞，等待 ACK 腾出空间
    await this.#packetMap.set(seqNr, {
      packet,
      resendTimes: 0,
      ackCount: 0,
      sentTime: Date.now(),
      remoteAddr: packetWithAddr.remoteAddr
    })
  }

  /**
   * 处理ACK包
   * @param ackPacket
   */
  handleAck(ackPacket: UtpPacket) {
    // 更新对端广播的接收窗口大小
    this.#remoteWindowBytes = ackPacket.windowSize

    // 更新对方收到的最大的包的序列号
    if (
      this.#latestSeqReceivedOfOtherSide === undefined ||
      Seq.gt(ackPacket.ackNr, this.#latestSeqReceivedOfOtherSide)
    ) {
      this.#latestSeqReceivedOfOtherSide = ackPacket.ackNr
    }

    // 更新ACK计数器
    const ackCount = this.#ackCounter.get(ackPacket.ackNr) || 0
    this.#ackCounter.set(ackPacket.ackNr, ackCount + 1)

    // 处理SACK扩展
    if (ackPacket.sackExtension) {
      const sack = ackPacket.sackExtension
      const ackedSeqNrs = sack.getRemoteReceivedSeqNrs()
      for (const seqNr of ackedSeqNrs) {
        const info = this.#packetMap.get(seqNr)
        if (info) {
          if (info.resendTimes === 0) this.#rttTracker.update(info)
          this.#packetMap.delete(seqNr)
          this.#totalAckedPackets++
        }
      }
    }

    // 处理累积ACK
    const seqNrs = this.getAllSeqNrs()
    for (const seqNr of seqNrs) {
      if (this.isPacketAcked(seqNr)) {
        const info = this.#packetMap.get(seqNr)
        if (info && info.resendTimes === 0) this.#rttTracker.update(info)
        this.#packetMap.delete(seqNr)
        this.#totalAckedPackets++
      }
    }

    // 根据最新RTT调整拥塞窗口（RTT tracker 保证 rtt >= 1，此处无需守卫）
    this.#congestionControl.updateRtt(this.#rttTracker.rtt)
    this.#applyWindowSize()

    this.logger.debug('SendWindow.handleAck', 'window capacity:', this.#packetMap.capacity, 'waiting ack count:', this.#packetMap.size)
  }

  /**
   * 检查发送窗口是否为空
   * @returns
   */
  isEmpty(): boolean {
    return this.#packetMap.size === 0
  }

  /**
   * 检查发送窗口是否不为空
   * @returns
   */
  isNotEmpty(): boolean {
    return this.#packetMap.size > 0
  }

  /**
   * 获取所有未确认的包的序列号
   * @returns
   */
  getAllSeqNrs(): number[] {
    return Array.from(this.#packetMap.keys())
  }

  /**
   * 获取发送窗口大小
   * @returns
   */
  getSize(): number {
    return this.#packetMap.size
  }

  /**
   * 重置发送窗口
   */
  reset(): void {
    this.#packetMap.clear()
    this.#ackCounter.clear()
    this.#latestSeqReceivedOfOtherSide = undefined
    this.#remoteWindowBytes = undefined
    this.#totalAckedPackets = 0
    this.#congestionControl.reset()
    this.#packetMap.updateCapacity(this.#minWindow)
  }
}
