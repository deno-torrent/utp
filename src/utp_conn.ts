import { BlockingBuffer } from '@src/blocking_buffer.ts'
import { CircularQueue } from '@src/circular_queue.ts'
import { Logger } from '@src/logger.ts'
import { Statistic } from '@src/statistic.ts'
import Util, { Seq } from '@src/utilt.ts'
import { UtpAddr } from '@src/utp_addr.ts'
import { UtpContext } from '@src/utp_context.ts'
import { UtpSelectiveAckExtension } from '@src/utp_ext_sack.ts'
import { UtpPacket, UtpPacketType } from '@src/utp_packet.ts'
import { UtpSendWindow } from '@src/utp_send_window.ts'
import { Utp } from '@src/utp_socket.ts'
import { assert } from 'std/assert/assert.ts'
import { Closer, Reader, Writer } from 'std/io/mod.ts'

export enum UtpConnState {
  CS_SYN_SENT,
  CS_SYN_RECV,
  CS_CONNECTED,
  CS_RESET,
  CS_CLOSE_WAIT,
  CS_CLOSED
}

export type UtpPacketWithAddr = {
  packet: UtpPacket
  remoteAddr: UtpAddr
}

export class UtpConn implements Reader, Writer, Closer {
  static CONNECT_TIMEOUT_DURATION = 5_000 // connection timeout duration, 5 seconds
  static CLOSE_TIMEOUT_DURATION = 10_000 // close timeout duration, 10 seconds
  static #KEEP_ALIVE_INTERVAL = 29_000 // keep alive interval, 29 seconds, the same as libutp
  static #MAX_RECV_QUEUE_SIZE = 8192 // 增加最大接收队列大小
  static #MIN_RECV_QUEUE_SIZE = 4096 // 增加最小接收队列大小
  static #DEFAULT_CHUNK_SIZE = 64 * 1024 // 默认数据块大小 64KB
  _localRecvId: number // connection id when receive a packet
  _localSendId: number // connection id when send a packet
  _localSeqNr: number // sequence number
  _localAckNr: number // acknowledgment number, must be continuous, the last received packet's sequence number,这里的ackNr是指本地收到的最大的包的序列号
  _localState: UtpConnState
  #remoteFinPacket?: UtpPacket // received ST_FIN packet, indicate remote data send finished
  #localFinPacket?: UtpPacket // sent ST_FIN packet, indicate local data send finished
  #localSynPacket?: UtpPacket // sent ST_SYN packet, indicate local connection request
  utp: Utp
  isInitiator: boolean // is the syn packet sender or not
  remoteAddr: UtpAddr // remote peer address
  offsetTime: number // offset time
  lastPacketTimestampMicroseconds!: number // last receive time
  lastLiveTime: number // last live time
  peerTimeIsInvalid: boolean // peer time is invalid
  listeners: ((state: UtpConnState) => void)[]
  recvPacketQueue: CircularQueue<UtpPacket> // 数据包循环队列,用于接收非连续seq的数据包,并对其排序
  recvBuffer: BlockingBuffer // 接收缓冲区
  sendWindow: UtpSendWindow
  statistic: Statistic
  closeStartTime?: number // start time of the close process
  logger: Logger

  /**
   * create a new connection, and wait for connecting
   * @param utp
   * @param initState
   * @param remoteAddr
   * @param sendId
   * @param recvId
   * @param seqNr
   * @param ackNr
   * @returns a new connection that is waiting for connecting
   */
  static connectTo(
    utp: Utp,
    initState: UtpConnState.CS_SYN_RECV | UtpConnState.CS_SYN_SENT,
    remoteAddr: UtpAddr,
    sendId: number,
    recvId: number,
    seqNr: number,
    ackNr: number
  ): Promise<UtpConn> {
    return new UtpConn(utp, initState, remoteAddr, sendId, recvId, seqNr, ackNr).waitForConnecting()
  }

  /**
   * create a new connection
   * @param utp
   * @param initState
   * @param remoteAddr
   */
  private constructor(
    utp: Utp,
    initState: UtpConnState.CS_SYN_RECV | UtpConnState.CS_SYN_SENT,
    remoteAddr: UtpAddr,
    sendId: number,
    recvId: number,
    seqNr: number,
    ackNr: number
  ) {
    this.utp = utp
    this._localState = initState
    this._localSendId = sendId
    this._localRecvId = recvId
    this._localSeqNr = seqNr
    this._localAckNr = ackNr
    this.remoteAddr = remoteAddr
    this.isInitiator = initState === UtpConnState.CS_SYN_SENT
    this.offsetTime = 0
    this.lastLiveTime = performance.now()
    this.peerTimeIsInvalid = false
    this.listeners = []

    // 初始化logger，使用连接ID作为标识
    this.logger = UtpContext.getInstance().getLogger(`CONN_${this.uniqueId()}`)

    // 根据连接类型动态调整接收队列大小
    const queueSize = this.isInitiator ? UtpConn.#MAX_RECV_QUEUE_SIZE : UtpConn.#MIN_RECV_QUEUE_SIZE
    this.recvPacketQueue = new CircularQueue(queueSize)

    this.recvBuffer = new BlockingBuffer()
    this.sendWindow = new UtpSendWindow(this)
    this.statistic = new Statistic()

    utp.addConn(this)
  }

  get localRecvId(): number {
    return this._localRecvId
  }

  get localSendId(): number {
    return this._localSendId
  }

  set localSeqNr(seqNumber: number) {
    this._localSeqNr = seqNumber & 0xFFFF
  }

  get localSeqNr(): number {
    return this._localSeqNr
  }

  set localAckNr(ackNumber: number) {
    this._localAckNr = ackNumber & 0xFFFF
  }

  /**
   * 接收到的最大确认号
   */
  get localAckNr(): number {
    return this._localAckNr
  }

  set localState(state: UtpConnState) {
    if (this._localState === state) return
    const oldState = this._localState
    const newState = state
    this._localState = state
    this.notifyStateChange(oldState, newState)
  }

  get localState(): UtpConnState {
    return this._localState
  }

  get tag(): string {
    return `[CONNECTION|${this.uniqueId()}|state(${UtpConnState[this.localState]})]`
  }

  get maxWriteSpeed(): number {
    return this.statistic.maxSentSpeed
  }

  get minWriteSpeed(): number {
    return this.statistic.minSentSpeed
  }

  get averageWriteSpeed(): number {
    return this.statistic.averageSentSpeed
  }

  get maxReadSpeed(): number {
    return this.statistic.maxRecvSpeed
  }

  get minReadSpeed(): number {
    return this.statistic.minRecvSpeed
  }

  get averageReadSpeed(): number {
    return this.statistic.averageRecvSpeed
  }

  /**
   * the unique identifier of the connection
   * @returns
   */
  uniqueId(): string {
    return UtpConn.generateUniqueId(this.remoteAddr, this._localSendId, this._localRecvId)
  }

  static generateUniqueId(remoteAddr: UtpAddr, localSendId: number, localRecvId: number): string {
    return `addr(${remoteAddr.toString()})|send_id(${localSendId})|recv_id(${localRecvId})`
  }

  notifyStateChange(oldState: UtpConnState, newState: UtpConnState): void {
    this.logger.debug(`[STATE CHANGE]: ${UtpConnState[oldState]} ===> ${UtpConnState[newState]}`)
    this.listeners.forEach((listener) => {
      listener(this.localState)
    })
  }

  addListener(listener: (state: UtpConnState) => void): void {
    this.listeners.push(listener)
  }

  removeListener(listener: (state: UtpConnState) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }

  /**
   * handle incoming packet at syn sent state
   * @param packet
   * @param remoteAddr
   * @returns true if the packet is handled, otherwise false
   */
  private handleAtSynSent(packetWithAddr: UtpPacketWithAddr): Promise<boolean> {
    const packet = packetWithAddr.packet
    if (packet.type !== UtpPacketType.ST_STATE) {
      this.logger.debug(`SynSentState: ignore packet type: ${packet.type}`)
      return Promise.resolve(false)
    }

    // 此时ackNr还没有初始化
    // uTP中ST_STATE（SYN-ACK）不消耗序列号，对端第一个ST_DATA与SYN-ACK使用
    // 相同的seqNr，因此localAckNr需设为seqNr-1，使duplicate检测正常工作
    this.localAckNr = Seq.add(packet.seqNr, -1)
    this.localState = UtpConnState.CS_CONNECTED
    return Promise.resolve(true)
  }

  /**
   * handle incoming packet at syn received state
   * @param packet
   * @param remoteAddr
   * @returns true if the packet is handled, otherwise false
   */
  private async handleAtSynReceived(packetWithAddr: UtpPacketWithAddr): Promise<boolean> {
    const packet = packetWithAddr.packet
    if (packet.type !== UtpPacketType.ST_DATA) {
      this.logger.debug(`SynReceivedState: ignore packet type: ${packet.type}`)
      return false
    }

    // check ack: 客户端应 ACK 我们的 SYN-ACK（SYN-ACK不消耗seqNr，ackNr = seqNr - 1）
    if (packet.ackNr !== Seq.add(this.localSeqNr, -1)) {
      this.logger.debug(
        `SynReceivedState: ignore packet ackNumber: ${packet.ackNr},because it's not equal to conn.seqNumber-1 ${Seq.add(this.localSeqNr, -1)}`
      )
      return false
    }

    // 此时ackNr还没有初始化,直接赋值
    this.localAckNr = packet.seqNr
    this.localState = UtpConnState.CS_CONNECTED

    // 直接将数据放入payload blocking queue,
    if (packet.data) {
      await this.recvBuffer.write(packet.data)
      // 更新统计数据
      this.statistic.updateRecvData(packet.data.length)
    }

    const selectAckExtension = UtpSelectiveAckExtension.createFromConn(this)
    const ackPacket = UtpPacket.createAckPacket(this, selectAckExtension)

    // 发送ACK
    await this.sendUtpPacket(ackPacket)

    this.logger.debug(`SynReceivedState: connection is connected`)
    return true
  }

  /**
   * handle incoming packet at connected state
   * @param packet
   * @param remoteAddr
   * @returns true if the packet is handled, otherwise false
   */
  private async handleAtConnected(packetWithAddr: UtpPacketWithAddr): Promise<boolean> {
    const packet = packetWithAddr.packet

    // 检查连接是否已关闭
    if (this.isClosed()) {
      this.logger.debug(`ConnectedState: 连接已关闭，忽略数据包`)
      return false
    }

    // 连接建立后,只处理ST_DATA和ST_FIN包
    if (packet.type !== UtpPacketType.ST_FIN && packet.type !== UtpPacketType.ST_DATA) {
      this.logger.debug(`ConnectedState: 忽略非数据包类型: ${packet.type}`)
      return false
    }

    // 丢弃重复的数据包
    if (packet.seqNr === this.localAckNr) {
      this.logger.debug(`ConnectedState: 丢弃重复的数据包 seqNr=${packet.seqNr}`)
      return false
    }

    if (this.#remoteFinPacket && Seq.gt(packet.seqNr, this.#remoteFinPacket.seqNr)) {
      this.logger.debug(`ConnectedState: 丢弃超出FIN包序号的数据包 seqNr=${packet.seqNr}, FIN_seqNr=${this.#remoteFinPacket.seqNr}`)
      return false
    }

    // 检查接收队列是否已满
    if (this.recvPacketQueue.size >= this.recvPacketQueue.capacity) {
      this.logger.debug(`ConnectedState: 接收队列已满, 当前大小=${this.recvPacketQueue.size}, 容量=${this.recvPacketQueue.capacity}`)
      // 如果队列已满，尝试处理已有的数据包
      await this.processReceivedPackets()
    }

    // 将收到的所有ST_DATA和ST_FIN包放入接收窗口
    try {
      this.recvPacketQueue.enqueue(packet.seqNr, packet)
      this.logger.debug(`ConnectedState: 成功将数据包加入队列 seqNr=${packet.seqNr}, 当前队列大小=${this.recvPacketQueue.size}`)
    } catch (error) {
      this.logger.debug(`ConnectedState: 将数据包加入队列失败 seqNr=${packet.seqNr}: ${error}`)
      return false
    }

    // 处理接收到的数据包
    await this.processReceivedPackets()

    // this is the last packet,close the connection
    if (packet.type === UtpPacketType.ST_FIN) {
      this.logger.debug(`ConnectedState: 收到FIN包 seqNr=${packet.seqNr}`)
      this.#remoteFinPacket = packet
      this.localState = UtpConnState.CS_CLOSE_WAIT
      
      // 立即发送本地的FIN包
      if (!this.#localFinPacket && !this.isClosed()) {
        try {
          this.logger.debug(`ConnectedState: 发送本地FIN包`)
          this.#localFinPacket = UtpPacket.createFinPacket(this)
          await this.sendUtpPacket(this.#localFinPacket)
        } catch (error) {
          this.logger.debug(`ConnectedState: 发送FIN包失败: ${error}`)
        }
      }
      
      // 强制关闭接收缓冲区
      this.recvBuffer.drain()
      
      // 尝试安全关闭连接
      await this.trySafeRelease()
    }

    // 再次检查连接是否已关闭，避免在连接关闭后发送ACK
    if (this.isClosed()) {
      this.logger.debug(`ConnectedState: 连接已关闭，不发送ACK`)
      return true
    }

    try {
      const selectAckExtension = UtpSelectiveAckExtension.createFromConn(this)
      const ackPacket = UtpPacket.createAckPacket(this, selectAckExtension)

      // 无论接收到的ackNr是否连续,都需要发送ACK,因为对端可能会重发数据包
      await this.sendUtpPacket(ackPacket)
      this.logger.debug(`ConnectedState: 发送ACK包 ackNr=${this.localAckNr}`)
    } catch (error) {
      this.logger.debug(`ConnectedState: 发送ACK包失败: ${error}`)
    }

    return true
  }

  private async processReceivedPackets(): Promise<void> {
    // 遍历队列,查看是否有连续的包
    for (const seq of this.recvPacketQueue.keys()) {
      // 只有在this.ackNr+1=seq时，才能更新ackNr
      if (Seq.add(this.localAckNr, 1) !== seq) {
        this.logger.debug(`ProcessReceivedPackets: 跳过不连续的包 seq=${seq}, 当前ackNr=${this.localAckNr}`)
        continue
      }

      // 更新ackNr
      this.localAckNr = seq
      this.logger.debug(`ProcessReceivedPackets: 更新ackNr=${seq}`)

      // 将解包的数据写入接收缓冲区
      const packet = this.recvPacketQueue.dequeueByKey(seq)
      if (!packet) {
        this.logger.debug(`ProcessReceivedPackets: 无法从队列中取出包 seq=${seq}`)
        continue
      }

      if (packet.data && packet.type === UtpPacketType.ST_DATA) {
        try {
          await this.recvBuffer.write(packet.data)
          this.statistic.updateRecvData(packet.data.length)
          this.logger.debug(`ProcessReceivedPackets: 成功写入数据到接收缓冲区 seq=${seq}, 数据大小=${packet.data.length}`)
        } catch (error) {
          this.logger.debug(`ProcessReceivedPackets: 写入数据到接收缓冲区失败 seq=${seq}: ${error}`)
        }
      }
    }
  }

  /**
   * handle incoming packet,but ST_SYN and ST_RESET packet will not be handled here
   * @param incomingPacket
   * @param addr
   * @returns
   */
  async handleIncomingPacket(packetWithAddr: UtpPacketWithAddr): Promise<boolean> {
    this.logger.debug(`=======> ${UtpConnState[this.localState]}: handleIncomingPacket`)
    this.logger.debug(packetWithAddr.packet.toString())

    // ack the packet in the send window
    if (packetWithAddr.packet.type === UtpPacketType.ST_STATE) {
      await this.sendWindow.handleAck(packetWithAddr.packet)
    }

    let handled = false
    switch (this.localState) {
      case UtpConnState.CS_SYN_SENT:
        handled = await this.handleAtSynSent(packetWithAddr)
        break
      case UtpConnState.CS_SYN_RECV:
        handled = await this.handleAtSynReceived(packetWithAddr)
        break
      case UtpConnState.CS_CONNECTED:
        handled = await this.handleAtConnected(packetWithAddr)
        break
      case UtpConnState.CS_CLOSE_WAIT:
        // 在CLOSE_WAIT状态下，仍然需要处理ACK包
        if (packetWithAddr.packet.type === UtpPacketType.ST_STATE) {
          await this.sendWindow.handleAck(packetWithAddr.packet)
          handled = true
        } else {
          this.logger.debug(`CloseWaitState: 忽略非ACK包类型: ${packetWithAddr.packet.type}`)
        }
        break
      case UtpConnState.CS_CLOSED:
      case UtpConnState.CS_RESET:
        // 已关闭或重置的连接不处理任何包
        break
      default:
        this.logger.debug(`未知状态: ${UtpConnState[this.localState]}`)
        break
    }

    if (handled) {
      this.lastPacketTimestampMicroseconds = Util.currentMicroseconds()
    }

    return handled
  }

  /**
   * 等待连接建立，这里需要处理两种情况，一种是本地是SYN包的发送方，一种是本地是SYN包的接收方
   */
  private async waitForConnecting(): Promise<UtpConn> {
    this.logger.debug(`${this.tag} is waiting for connecting`)

    // 如果已经连接，直接解决 Promise
    if (this.localState === UtpConnState.CS_CONNECTED) {
      this.logger.debug(`${this.tag} is already connected`)
      return this
    }

    let packet: UtpPacket
    // 发起连接尝试
    if (this.isInitiator) {
      packet = UtpPacket.createSynPacket(this)
      this.#localSynPacket = packet
      // SYN 消耗一个序列号，与服务端的 SYN-ACK 保持一致
      // BEP 29：发送方下一个 DATA 的 seqNr 必须比 SYN 大 1
      this.localSeqNr++
    } else {
      packet = UtpPacket.createAckPacket(this)
      // uTP中ST_STATE（SYN-ACK）不消耗序列号——与Transmission等主流实现保持一致：
      // 服务端第一个ST_DATA与SYN-ACK共用同一seqNr。
      // 注意：不再执行 localSeqNr++ 以匹配BEP 29标准行为
    }

    await this.sendUtpPacket(packet)

    // 返回一个新的 Promise，它会在状态变为 CONNECTED 时解决
    return new Promise((resolve, reject) => {
      // 设置连接超时
      const timeoutId = setTimeout(() => {
        this.removeListener(onStateChange)
        reject(new Error(`Connection timeout after ${UtpConn.CONNECT_TIMEOUT_DURATION}ms`))
      }, UtpConn.CONNECT_TIMEOUT_DURATION)

      // 状态变化监听器
      const onStateChange = (state: UtpConnState): void => {
        if (state === UtpConnState.CS_CONNECTED) {
          this.removeListener(onStateChange)
          clearTimeout(timeoutId)
          resolve(this)
        } else if (state === UtpConnState.CS_RESET) {
          this.removeListener(onStateChange)
          clearTimeout(timeoutId)
          reject(new Error('Connection reset by remote'))
        } else if (state === UtpConnState.CS_CLOSED) {
          this.removeListener(onStateChange)
          clearTimeout(timeoutId)
          reject(new Error('Connection is closed'))
        }
      }

      try {
        // 添加状态变化监听器
        this.addListener(onStateChange)
      } catch (e) {
        // 移除状态变化监听器和超时定时器
        this.removeListener(onStateChange)
        clearTimeout(timeoutId)
        reject(e)
      }
    })
  }

  async read(buffer: Uint8Array): Promise<number | null> {
    return await this.recvBuffer.read(buffer)
  }

  /**
   * 获取最大允许发送的数据包大小,也就是此大小的数据包不会被分片
   * get the maximum allowed size of the data packet sent, that is, the data packet of this size will not be fragmented
   */
  getMaxPacketSize(): number {
    return Utp.DEFAULT_MTU
  }

  /**
   * write data to the connection
   * @param bytes data to write
   */
  async write(dataToSend: Uint8Array): Promise<number> {
    this.logger.debug(`Write: 开始发送数据, 总大小=${dataToSend.length}`)

    const chunkSize = Math.min(UtpConn.#DEFAULT_CHUNK_SIZE, Utp.DEFAULT_MTU - UtpPacket.HEADER_SIZE)
    let offset = 0

    while (offset < dataToSend.length) {
      // 创建分片
      const chunk = dataToSend.subarray(offset, offset + chunkSize)
      this.logger.debug(`Write: 创建数据分片, 大小=${chunk.length}, 偏移量=${offset}`)

      // 创建数据包以获取实际的扩展大小
      const dataPacket = UtpPacket.createDataPacket(this, chunk)

      // 发送数据包
      const n = await this.sendUtpPacket(dataPacket)
      this.logger.debug(`Write: 发送数据包, 大小=${n}, seqNr=${dataPacket.seqNr}`)

      assert(
        n === dataPacket.length(),
        `发送的数据包长度不等于要发送的数据包长度,发送的数据包长度${n},要发送的数据包长度${dataPacket.length}`
      )

      // 更新发送统计
      this.statistic.updateSentData(chunk.length)

      // 更新偏移量
      offset += chunk.length
    }

    assert(
      dataToSend.length === offset,
      `发送的数据长度不等于要发送的数据长度,发送的数据长度${offset},要发送的数据长度${dataToSend.length}`
    )

    this.logger.debug(`Write: 数据发送完成, 总大小=${offset}`)
    return dataToSend.length
  }

  getIncomingBufferLeftBytes(): number {
    return this.recvBuffer.freeSpace
  }

  /**
   * check if the connection is timeout
   */
  async timeoutCheck(): Promise<void> {
    switch (this.localState) {
      case UtpConnState.CS_SYN_SENT: {
        const isConnectTimeout =
          this.#localSynPacket &&
          Util.currentMicroseconds() - this.#localSynPacket.timestampMicroseconds > UtpConn.CONNECT_TIMEOUT_DURATION * 1000
        if (isConnectTimeout) {
          this.logger.debug(`Connection ${this.tag} connect timeout, force close`)
          this.forceClose()
        }
        break
      }
      case UtpConnState.CS_SYN_RECV:
      case UtpConnState.CS_CONNECTED:
        {
          // 检查是否需要发送keep alive包
          const now = performance.now()
          if (now - this.lastLiveTime > UtpConn.#KEEP_ALIVE_INTERVAL) {
            this.logger.debug(`Connection ${this.tag} sending keep alive packet`)
            await this.sendUtpPacket(UtpPacket.createAckPacket(this, UtpSelectiveAckExtension.createFromConn(this)))
            this.lastLiveTime = now
          }

          // 检查连接是否超时
          await this.sendWindow.timeoutCheck()
        }
        break
      case UtpConnState.CS_CLOSE_WAIT: {
        await this.sendWindow.timeoutCheck()
        await this.trySafeRelease()
        break
      }
      default:
        break
    }
  }

  /**
   * 安全关闭连接的善后工作
   * 1.查看是否还有待ACK的数据包,可能存在丢包,需要重发
   * 2.发送ST_FIN包,通知对方数据发送完毕
   * 3.等待对方发送ST_FIN包,通知数据接收完毕
   * 4.关闭连接
   * @returns
   */
  private async trySafeRelease(): Promise<void> {
    this.logger.debug(`try safe release connection ${this.tag}`)

    if (this.localState !== UtpConnState.CS_CLOSE_WAIT) {
      throw new Error('Connection is not in CLOSE_WAIT state')
    }

    // 检查是否超时
    const closeStartTime = this.closeStartTime || performance.now()
    if (performance.now() - closeStartTime > UtpConn.CLOSE_TIMEOUT_DURATION) {
      this.logger.debug(`Connection ${this.tag} close timeout, force close`)
      this.forceClose()
      return
    }

    // 如果已经收到了远程的FIN包，并且发送窗口为空，直接关闭连接
    if (this.#remoteFinPacket && this.sendWindow.isEmpty()) {
      this.logger.debug(`Remote FIN packet received and send window is empty, closing connection`)
      this.forceClose()
      return
    }

    // there are still packets that have not received ACK, wait for processing
    if (this.sendWindow.isNotEmpty()) {
      this.logger.debug(`${this.sendWindow.getSize()} packets have not received ACK, wait for processing`)
      return
    }

    // if has not sent fin packet, send it
    if (!this.#remoteFinPacket && !this.#localFinPacket) {
      this.logger.debug(`send fin packet to remote address, request close connection`)
      this.#localFinPacket = UtpPacket.createFinPacket(this)
      // send fin packet
      await this.sendUtpPacket(this.#localFinPacket)
      return
    } else if (this.#remoteFinPacket) {
      this.logger.debug(`remote fin packet has been received, remote request close connection`)
    }

    // 从socket的连接列表中移除当前连接
    this.utp.removeCon(this)

    // 释放数据统计
    this.statistic.release()

    // 更改状态为CS_CLOSED
    this.logger.debug(`Connection ${this.tag} release successfully`)
    this.localState = UtpConnState.CS_CLOSED
  }

  /**
   * close the connection
   */
  async close(): Promise<void> {
    if (this.isClosed()) {
      this.logger.debug(`Connection ${this.tag} is already closed`)
      return
    }

    if (this.localState === UtpConnState.CS_CLOSE_WAIT) {
      this.logger.debug(`Connection ${this.tag} is already in CLOSE_WAIT state`)
      return
    }

    if (this.localState === UtpConnState.CS_RESET) {
      this.logger.debug(`Connection ${this.tag} is already reset`)
      return
    }

    // 记录开始关闭的时间
    this.closeStartTime = performance.now()

    // 更改状态为CS_CLOSE_WAIT,等待释放资源
    this.localState = UtpConnState.CS_CLOSE_WAIT

    // 发送FIN包
    if (!this.#localFinPacket) {
      this.logger.debug(`Close: 发送FIN包`)
      this.#localFinPacket = UtpPacket.createFinPacket(this)
      await this.sendUtpPacket(this.#localFinPacket)
    }

    // 等待连接完全关闭，设置超时时间为10秒
    return new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          // 如果连接已经关闭，直接解决 Promise
          if (this.isClosed()) {
            clearInterval(checkInterval)
            resolve()
            return
          }

          // 检查是否超时
          if (performance.now() - this.closeStartTime! > UtpConn.CLOSE_TIMEOUT_DURATION) {
            clearInterval(checkInterval)
            this.logger.debug(`Connection ${this.tag} close timeout, force close`)
            this.forceClose()
            resolve()
            return
          }

          // 尝试安全释放连接
          await this.trySafeRelease()

          // 如果连接已经关闭，解决 Promise
          if (this.isClosed()) {
            clearInterval(checkInterval)
            resolve()
          }
        } catch (error) {
          clearInterval(checkInterval)
          this.logger.debug(`Connection ${this.tag} close error: ${error}`)
          this.forceClose()
          resolve() // 即使出错也解决 Promise，避免挂起
        }
      }, 100) // 检查间隔为100ms
    })
  }

  reset(): void {
    this.logger.debug(`Reset connection ${this.tag}`)
    this.utp.removeCon(this)
    this.statistic.release()
    this.localState = UtpConnState.CS_RESET
    this.recvPacketQueue.clear()
    this.#remoteFinPacket = undefined
    this.sendWindow.reset()
    this.sendUtpPacket(UtpPacket.createResetPacket(this))
  }

  /**
   * send utp packet to remote address
   * @param outgoingPacket
   * @returns
   */
  async sendUtpPacket(outgoingPacket: UtpPacket): Promise<number> {
    this.lastLiveTime = performance.now()
    this.logger.debug('=======> Send utp packet to remote address', this.remoteAddr)
    this.logger.debug(outgoingPacket.toString())

    // 检查连接状态，如果已关闭则抛出异常
    if (this.isClosed()) {
      throw new Error(`Cannot send packet on closed connection ${this.tag}`)
    }

    // sendWindow只有在连接建立后才会启用
    // 优先将数据包放入发送窗口后,再发送数据包
    // 只将ST_DATA和ST_FIN包放入发送窗口,其他包不放入发送窗口
    if (
      this.localState === UtpConnState.CS_CONNECTED &&
      [UtpPacketType.ST_DATA, UtpPacketType.ST_FIN].includes(outgoingPacket.type)
    ) {
      await this.sendWindow.waitForAck({
        packet: outgoingPacket,
        remoteAddr: this.remoteAddr
      })
    }

    // 发送数据包
    return await this.utp.sendUtpPacket(outgoingPacket, this.remoteAddr)
  }

  isConnected(): boolean {
    return this.localState === UtpConnState.CS_CONNECTED
  }

  isClosed(): boolean {
    return this.localState === UtpConnState.CS_CLOSED
  }

  private forceClose(): void {
    this.logger.debug(`Force closing connection ${this.tag}`)
    // drain() 而非 close()：保留缓冲区内尚未读取的数据，让应用层可以继续读取；
    // 缓冲区耗尽后 read() 自动返回 null（EOF）。
    this.recvBuffer.drain()
    this.utp.removeCon(this)
    this.statistic.release()
    this.localState = UtpConnState.CS_CLOSED
  }
}
