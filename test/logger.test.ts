import { Logger } from '../src/logger.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('Logger singleton test', () => {
  // 获取第一个实例
  const logger1 = Logger.getInstance('test')
  assertEquals(logger1, Logger.getInstance('test'))

  // 不同的 tag 应该有不同的实例
  const logger2 = Logger.getInstance('another')
  assertEquals(logger2, Logger.getInstance('another'))
  assertEquals(logger1 !== logger2, true)
})

Deno.test('Logger enable/disable test', () => {
  const logger = Logger.getInstance('test')
  
  // 默认启用
  assertEquals(logger['isEnabled'], true)
  
  // 禁用日志
  logger.disable()
  assertEquals(logger['isEnabled'], false)
  
  // 启用日志
  logger.enable()
  assertEquals(logger['isEnabled'], true)
})

Deno.test('Logger global debug test', () => {
  const logger = Logger.getInstance('test')
  
  // 默认全局调试关闭
  assertEquals(Logger['globalDebugEnabled'], false)
  
  // 设置全局调试
  Logger.setGlobalDebug(true)
  assertEquals(Logger['globalDebugEnabled'], true)
  
  // 重置全局调试
  Logger.setGlobalDebug(false)
  assertEquals(Logger['globalDebugEnabled'], false)
})

Deno.test('Logger tag debug state test', () => {
  // 创建带标签的日志器
  const logger = Logger.getInstance('test')
  
  // 检查标签状态
  assertEquals(Logger['tagDebugState'].get('test'), true)
  
  // 禁用标签日志
  logger.disable()
  assertEquals(Logger['tagDebugState'].get('test'), false)
  
  // 启用标签日志
  logger.enable()
  assertEquals(Logger['tagDebugState'].get('test'), true)
})

Deno.test('Logger format time test', () => {
  const logger = Logger.getInstance('test')
  const time = logger['formatTime']()
  
  // 检查时间格式
  const date = new Date()
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  
  const expectedPrefix = `${year}-${month}-${day}`
  assertEquals(time.startsWith(expectedPrefix), true)
})

Deno.test('Logger log methods test', () => {
  const logger = Logger.getInstance('test')
  
  // 由于日志输出到控制台，我们只能测试方法是否正常调用
  // 这里我们使用 try-catch 来确保方法不会抛出错误
  try {
    logger.debug('Debug message')
    logger.info('Info message')
    logger.error('Error message')
  } catch (error) {
    assertEquals(error, undefined)
  }
}) 