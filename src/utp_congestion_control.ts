import { Logger } from '@src/logger.ts'
import { UtpContext } from '@src/utp_context.ts'

/**
 * UTP拥塞控制类, 用于模拟LEDBAT拥塞控制算法
 */
export class UtpCongestionControl {
  #windowSize: number // 拥塞窗口大小
  #baseDelay: number // 基础延迟，最低RTT
  #queueDelay: number // 队列延迟
  #targetDelay: number // 目标延迟
  #lastMaxDelay: number // 上次的最大延迟，用于计算延迟增加
  #gain: number // LEDBAT增益
  logger: Logger

  constructor(windowSize: number = 1, targetDelay: number = 100) {
    this.#windowSize = windowSize // 初始拥塞窗口大小 单位为包的数量
    this.#baseDelay = Number.MAX_SAFE_INTEGER // 初始化基础延迟
    this.#queueDelay = 0 // 初始化队列延迟
    this.#targetDelay = targetDelay // 设置目标延迟
    this.#lastMaxDelay = 0 // 初始化上次的最大延迟
    this.#gain = 1 // 初始化LEDBAT增益
    this.logger = UtpContext.getInstance().getLogger('CONGESTION_CONTROL')
  }

  // 更新基于外部测量的RTT
  // @param measuredRtt: 测量的当前RTT
  public updateRtt(measuredRtt: number): void {
    // 更新基础延迟
    this.#baseDelay = Math.min(this.#baseDelay, measuredRtt)

    // 计算队列延迟
    this.#queueDelay = measuredRtt - this.#baseDelay

    // 更新拥塞窗口大小
    this.updateWindowSize()
  }

  // 更新拥塞窗口大小
  private updateWindowSize(): void {
    // 计算延迟增加
    const offTarget = (this.#targetDelay - this.#queueDelay) / this.#targetDelay
    const windowIncrease = this.#gain * offTarget

    if (this.#queueDelay <= this.#targetDelay) {
      // 如果队列延迟未超过目标，则线性增加窗口大小
      this.#windowSize += windowIncrease
    } else if (this.#queueDelay > this.#lastMaxDelay) {
      // 如果队列延迟超过了上次的最大延迟，则减少窗口大小
      this.#windowSize *= 1 - windowIncrease
    }

    // 确保窗口大小至少为1
    this.#windowSize = Math.max(this.#windowSize, 1)

    // 向上取整,优化运算速度
    this.#windowSize = Math.ceil(this.#windowSize)

    // 更新上次的最大延迟
    this.#lastMaxDelay = this.#queueDelay

    this.printState()
  }

  // 丢包事件的处理
  public onPacketLoss(): void {
    // 发生丢包时减小窗口大小
    this.#windowSize *= 0.5 // 窗口大小减半
    // 保证窗口大小不小于1
    this.#windowSize = Math.max(this.#windowSize, 1)

    this.printState()
  }

  // 获取当前拥塞窗口大小
  public getWindowSize(): number {
    return this.#windowSize
  }

  printState() {
    this.logger.debug(`baseDelay: ${this.#baseDelay}, queueDelay: ${this.#queueDelay}, windowSize: ${this.#windowSize}`)
  }

  reset() {
    this.#windowSize = 1
    this.#baseDelay = Number.MAX_SAFE_INTEGER
    this.#queueDelay = 0
    this.#lastMaxDelay = 0
  }
}
