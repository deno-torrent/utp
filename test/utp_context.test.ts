import { UtpContext } from '../src/utp_context.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('UtpContext singleton test', () => {
  // 获取第一个实例
  const context1 = UtpContext.getInstance()
  assertEquals(context1, UtpContext.getInstance())
})

Deno.test('UtpContext log level test', () => {
  const context = UtpContext.getInstance()
  
  // 测试默认日志级别
  assertEquals(context.getConfig().logLevel, UtpContext.LOG_LEVEL.INFO)
  
  // 设置新的日志级别
  context.setLogLevel(UtpContext.LOG_LEVEL.DEBUG)
  assertEquals(context.getConfig().logLevel, UtpContext.LOG_LEVEL.DEBUG)
  
  // 重置日志级别
  context.setLogLevel(UtpContext.LOG_LEVEL.INFO)
  assertEquals(context.getConfig().logLevel, UtpContext.LOG_LEVEL.INFO)
})

Deno.test('UtpContext debug mode test', () => {
  const context = UtpContext.getInstance()
  
  // 测试默认调试模式
  assertEquals(context.getConfig().enableDebug, false)
  
  // 启用调试模式
  context.setDebug(true)
  assertEquals(context.getConfig().enableDebug, true)
  
  // 禁用调试模式
  context.setDebug(false)
  assertEquals(context.getConfig().enableDebug, false)
})

Deno.test('UtpContext listener type test', () => {
  const context = UtpContext.getInstance()
  
  // 测试默认监听类型
  const logger1 = context.getLogger('test')
  assertEquals(logger1['tag'].startsWith('UNKNOWN:'), true)
  
  // 设置新的监听类型
  context.setListenerType('SERVER')
  const logger2 = context.getLogger('test')
  assertEquals(logger2['tag'].startsWith('SERVER:'), true)
})

Deno.test('UtpContext logger cache test', () => {
  const context = UtpContext.getInstance()
  
  // 获取相同模块的日志器两次
  const logger1 = context.getLogger('test')
  const logger2 = context.getLogger('test')
  
  // 应该返回相同的日志器实例
  assertEquals(logger1, logger2)
  
  // 获取不同模块的日志器
  const logger3 = context.getLogger('another')
  assertEquals(logger1 !== logger3, true)
})

Deno.test('UtpContext config update test', () => {
  const context = UtpContext.getInstance()
  
  // 获取默认配置
  const defaultConfig = context.getConfig()
  
  // 更新部分配置
  context.updateConfig({
    rtoMin: 1000,
    rtoMax: 20000
  })
  
  // 获取更新后的配置
  const newConfig = context.getConfig()
  
  // 检查更新的值
  assertEquals(newConfig.rtoMin, 1000)
  assertEquals(newConfig.rtoMax, 20000)
  
  // 检查未更新的值保持不变
  assertEquals(newConfig.logLevel, defaultConfig.logLevel)
  assertEquals(newConfig.enableDebug, defaultConfig.enableDebug)
  assertEquals(newConfig.resendLimit, defaultConfig.resendLimit)
  assertEquals(newConfig.windowSize, defaultConfig.windowSize)
}) 