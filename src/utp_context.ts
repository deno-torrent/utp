// src/utp_context.ts
import { Logger } from './logger.ts';

export class UtpContext {
    private static instance: UtpContext | null = null;

    // 日志级别
    static readonly LOG_LEVEL = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    };

    // 全局配置
    private config = {
        logLevel: UtpContext.LOG_LEVEL.INFO,
        enableDebug: false,
        rtoMin: 500,  // 最小重传超时时间(ms)
        rtoMax: 10000, // 最大重传超时时间(ms)
        resendLimit: 5, // 最大重传次数
        windowSize: {
            min: 4,
            max: Number.MAX_SAFE_INTEGER
        }
    };

    // 监听类型
    private listenerType: string = 'UNKNOWN';

    // 日志对象缓存
    private loggers: Map<string, Logger> = new Map();

    private constructor() { }

    static getInstance(): UtpContext {
        if (!UtpContext.instance) {
            UtpContext.instance = new UtpContext();
        }
        return UtpContext.instance;
    }

    // 设置监听类型
    setListenerType(type: string) {
        if (type === this.listenerType) {
            return;
        }
        this.listenerType = type;
        // 清除所有缓存的日志对象，因为标签会改变
        this.loggers.clear();
    }

    // 获取日志对象
    getLogger(moduleType: string): Logger {
        const key = `${this.listenerType}:${moduleType}`;
        let logger = this.loggers.get(key);
        if (!logger) {
            // 使用Logger.getInstance()方法获取Logger实例
            logger = Logger.getInstance(key, this.config.enableDebug);
            this.loggers.set(key, logger);
        }
        return logger;
    }

    // 设置日志级别
    setLogLevel(level: number) {
        this.config.logLevel = level;
    }

    // 启用/禁用调试日志
    setDebug(enable: boolean) {
        this.config.enableDebug = enable;
        Logger.setGlobalDebug(enable);
        for (const logger of this.loggers.values()) {
            if (enable) {
                logger.enable();
            } else {
                logger.disable();
            }
        }
    }

    // 获取配置
    getConfig() {
        return { ...this.config };
    }

    // 更新配置
    updateConfig(newConfig: Partial<typeof this.config>) {
        Object.assign(this.config, newConfig);
    }
}