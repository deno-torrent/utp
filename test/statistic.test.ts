import { Statistic } from '../src/statistic.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('Statistic basic data update test', () => {
  const stat = new Statistic()

  // 测试初始状态
  assertEquals(stat.totalSentData, 0)
  assertEquals(stat.totalRecvData, 0)
  assertEquals(stat.lastSentSpeed, 0)
  assertEquals(stat.lastRecvSpeed, 0)

  // 更新发送和接收数据
  stat.updateSentData(100)
  stat.updateRecvData(200)

  assertEquals(stat.totalSentData, 100)
  assertEquals(stat.totalRecvData, 200)
  assertEquals(stat.lastSentSpeed, 100)
  assertEquals(stat.lastRecvSpeed, 200)

  // 释放资源
  stat.release()
})

Deno.test('Statistic speed measurement test', async () => {
  const stat = new Statistic()

  // 开始速度测量
  stat.startSpeedMeasurement()

  // 更新数据
  stat.updateSentData(100)
  stat.updateRecvData(200)

  // 等待一秒让速度测量更新
  await new Promise(resolve => setTimeout(resolve, 1100))

  // 检查速度统计
  assertEquals(stat.maxSentSpeed, 100)
  assertEquals(stat.minSentSpeed, 100)
  assertEquals(stat.maxRecvSpeed, 200)
  assertEquals(stat.minRecvSpeed, 200)
  assertEquals(stat.averageSentSpeed, 100)
  assertEquals(stat.averageRecvSpeed, 200)

  // 释放资源
  stat.release()
})

Deno.test('Statistic clear test', () => {
  const stat = new Statistic()

  // 更新数据
  stat.updateSentData(100)
  stat.updateRecvData(200)

  // 清空统计
  stat.clear()

  // 检查所有值是否被重置
  assertEquals(stat.totalSentData, 0)
  assertEquals(stat.totalRecvData, 0)
  assertEquals(stat.lastSentSpeed, 0)
  assertEquals(stat.lastRecvSpeed, 0)
  assertEquals(stat.maxSentSpeed, 0)
  assertEquals(stat.minSentSpeed, 0)
  assertEquals(stat.maxRecvSpeed, 0)
  assertEquals(stat.minRecvSpeed, 0)
  assertEquals(stat.averageSentSpeed, 0)
  assertEquals(stat.averageRecvSpeed, 0)
})

Deno.test('Statistic multiple updates test', async () => {
  const stat = new Statistic()

  // 开始速度测量
  stat.startSpeedMeasurement()

  // 多次更新数据
  stat.updateSentData(100)
  stat.updateRecvData(200)
  stat.updateSentData(150)
  stat.updateRecvData(250)

  // 等待一秒让速度测量更新
  await new Promise(resolve => setTimeout(resolve, 1100))

  // 检查累计数据
  assertEquals(stat.totalSentData, 250)
  assertEquals(stat.totalRecvData, 450)

  // 检查速度统计
  assertEquals(stat.maxSentSpeed, 250)
  assertEquals(stat.maxRecvSpeed, 450)
  assertEquals(stat.averageSentSpeed, 250)
  assertEquals(stat.averageRecvSpeed, 450)

  // 释放资源
  stat.release()
}) 