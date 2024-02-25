import { Logger } from '@src/logger.ts'
import { UtpConn } from '@src/utp_conn.ts'
import { UtpContext } from '@src/utp_context.ts'

/**
 * UTP监听器类，用于接受新的连接
 */
export class UTPListener implements AsyncIterable<UtpConn> {
  private connections: UtpConn[] = [] // 存储所有连接
  private pendingConnections: UtpConn[] = [] // 存储待处理的连接
  private isClosed: boolean = false // 监听器是否已关闭
  private resolveNext: ((value: UtpConn) => void) | null = null // 用于解析下一个连接的Promise
  logger: Logger // 日志记录器

  constructor() {
    // 使用Context获取Logger实例
    this.logger = UtpContext.getInstance().getLogger('UTP_LISTENER')
  }

  // 添加新连接
  addConnection(conn: UtpConn) {
    if (this.isClosed) {
      this.logger.debug('Listener is closed, rejecting connection')
      conn.close()
      return
    }

    this.connections.push(conn) // 将连接添加到连接列表

    if (this.resolveNext) {
      this.resolveNext(conn) // 如果有等待的连接请求，则解析它
      this.resolveNext = null // 清除等待的解析函数
    } else {
      this.pendingConnections.push(conn) // 无等待者时才加入待处理列表
    }
  }

  // 接受新连接
  accept(): Promise<UtpConn> {
    if (this.isClosed) {
      throw new Error('Listener is closed') // 如果监听器已关闭，则抛出错误
    }

    if (this.pendingConnections.length > 0) {
      const conn = this.pendingConnections.shift()! // 从待处理列表中取出一个连接
      return Promise.resolve(conn) // 返回连接
    }

    return new Promise<UtpConn>((resolve) => {
      this.resolveNext = resolve // 存储解析函数，等待新连接
    })
  }

  // 关闭监听器
  close() {
    this.isClosed = true // 标记监听器为已关闭
    this.connections.forEach((conn) => conn.close()) // 关闭所有连接
    this.connections = [] // 清空连接列表
    this.pendingConnections = [] // 清空待处理列表

    if (this.resolveNext) {
      this.resolveNext(null!) // 如果有等待的连接请求，则解析为null
      this.resolveNext = null // 清除等待的解析函数
    }
  }

  // 实现AsyncIterable接口
  [Symbol.asyncIterator](): AsyncIterator<UtpConn> {
    return {
      next: async () => {
        try {
          const conn = await this.accept() // 接受新连接
          return { value: conn, done: false } // 返回连接和未完成的标志
        } catch (_error) {
          return { value: null!, done: true } // 如果出错，则返回null和完成的标志
        }
      }
    }
  }
}
