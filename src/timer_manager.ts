export class TimerManager {
  private static timers: Map<string, number> = new Map()

  /**
   * 创建或更新一个定时检测任务
   * @param key 用于标识定时任务的字符串key
   * @param callback 定时执行的回调函数
   * @param interval 定时器间隔时间（毫秒）
   */
  static setTimer(key: string, callback: () => void, interval: number): void {
    // 如果已存在同名定时器，先清除
    if (this.timers.has(key)) {
      this.clearTimer(key)
    }
    // 创建新的定时器
    const timer = setInterval(callback, interval)
    // 保存定时器引用
    this.timers.set(key, timer)
  }

  /**
   * 判断指定的定时检测任务是否存在
   * @param key
   * @returns
   */
  static exist(key: string): boolean {
    return this.timers.has(key)
  }

  /**
   * 清除指定的定时检测任务
   * @param key 用于标识定时任务的字符串key
   */
  static clearTimer(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(key)
    }
  }

  /**
   * 清除所有定时检测任务
   */
  static clearAllTimers(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()
  }
}
