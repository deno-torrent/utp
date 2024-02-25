/**
 * 日志类，用于管理日志输出
 */
export class Logger {
  private tag: string;
  private isEnabled: boolean;
  private static globalDebugEnabled: boolean = false;
  private static tagDebugState: Map<string, boolean> = new Map();
  private static instances: Map<string, Logger> = new Map();

  /**
   * 私有构造函数，防止直接实例化
   * @param tag 日志标签
   * @param enableLogging 是否启用日志
   */
  private constructor(tag: string = '', enableLogging: boolean = true) {
    this.tag = tag;
    this.isEnabled = enableLogging;
    
    if (tag) {
      Logger.tagDebugState.set(tag, enableLogging);
    }
  }

  /**
   * 从Context获取Logger实例
   * @param tag 日志标签
   * @param enableLogging 是否启用日志
   * @returns Logger实例
   */
  static getInstance(tag: string = '', enableLogging: boolean = true): Logger {
    let instance = Logger.instances.get(tag);
    if (!instance) {
      instance = new Logger(tag, enableLogging);
      Logger.instances.set(tag, instance);
    }
    return instance;
  }

  /**
   * 设置全局调试状态
   * @param enabled 是否启用全局调试
   */
  static setGlobalDebug(enabled: boolean): void {
    Logger.globalDebugEnabled = enabled;
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.isEnabled = true;
    if (this.tag) {
      Logger.tagDebugState.set(this.tag, true);
    }
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.isEnabled = false;
    if (this.tag) {
      Logger.tagDebugState.set(this.tag, false);
    }
  }

  /**
   * 检查日志是否应该启用
   */
  private isLogEnabled(): boolean {
    if (!this.tag) return this.isEnabled && Logger.globalDebugEnabled;
    return Logger.tagDebugState.has(this.tag) 
      ? Logger.tagDebugState.get(this.tag) as boolean 
      : this.isEnabled && Logger.globalDebugEnabled;
  }

  /**
   * 获取带颜色的TAG标识
   */
  private getTagPrefix(): string {
    if (!this.tag) return '';
    // 使用不同的颜色来区分不同的TAG
    const tagColor = '\x1b[35m'; // 紫色
    return `[${tagColor}${this.tag}\x1b[0m]`;
  }

  /**
   * 格式化时间
   */
  private formatTime(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();

    return `${year}-${month}-${day} ${hour}:${minute.toString().padStart(2, '0')}:${second
      .toString()
      .padStart(2, '0')}`;
  }

  /**
   * 调试日志
   */
  debug(message?: unknown, ...optionalParams: unknown[]): void {
    if (!this.isLogEnabled()) return;

    const time = this.formatTime();
    const formattedTime = `\x1b[36m${time}\x1b[0m`;
    const formattedMessage = `[${formattedTime}] ${this.getTagPrefix()} ${message}`;

    console.log(formattedMessage, ...optionalParams);
  }

  /**
   * 错误日志
   */
  error(message?: unknown, ...optionalParams: unknown[]): void {
    const time = this.formatTime();
    const formattedTime = `\x1b[31m${time}\x1b[0m`;
    const formattedMessage = `[${formattedTime}] ${this.getTagPrefix()} ${message}`;

    console.error(formattedMessage, ...optionalParams);
  }

  /**
   * 信息日志
   */
  info(message?: unknown, ...optionalParams: unknown[]): void {
    const time = this.formatTime();
    const formattedTime = `\x1b[32m${time}\x1b[0m`;
    const formattedMessage = `[${formattedTime}] ${this.getTagPrefix()} ${message}`;

    console.info(formattedMessage, ...optionalParams);
  }
} 