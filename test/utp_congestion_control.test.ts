import { UtpCongestionControl } from '@src/utp_congestion_control.ts'
import { assertEquals, assertGreater } from 'std/assert/mod.ts'

Deno.test('CongestionControl 初始窗口大小', () => {
  const cc = new UtpCongestionControl(4)
  assertEquals(cc.getWindowSize(), 4)
})

Deno.test('CongestionControl 低延迟时窗口线性增大', () => {
  const cc = new UtpCongestionControl(4, 100)
  const before = cc.getWindowSize()
  // RTT=50ms 远低于目标延迟 100ms，queueDelay=0，窗口应增大
  cc.updateRtt(50)
  assertGreater(cc.getWindowSize(), before, '低延迟时窗口应增大')
})

Deno.test('CongestionControl 第一次 updateRtt 确立 baseDelay', () => {
  const cc = new UtpCongestionControl(1, 100)
  cc.updateRtt(30)
  // 首次调用：baseDelay=30, queueDelay=0, offTarget=1, windowSize += 1 => 2
  assertEquals(cc.getWindowSize(), 2)
})

Deno.test('CongestionControl 丢包时窗口减半', () => {
  const cc = new UtpCongestionControl(8, 100)
  cc.onPacketLoss()
  assertEquals(cc.getWindowSize(), 4)
})

Deno.test('CongestionControl 丢包后窗口不低于1', () => {
  const cc = new UtpCongestionControl(1, 100)
  cc.onPacketLoss()
  assertEquals(cc.getWindowSize(), 1, '窗口大小最小为1')
})

Deno.test('CongestionControl reset 重置状态后窗口为1', () => {
  const cc = new UtpCongestionControl(8, 100)
  cc.updateRtt(50)
  cc.onPacketLoss()
  cc.reset()
  assertEquals(cc.getWindowSize(), 1, 'reset 后窗口应恢复为1')
})

Deno.test('CongestionControl 持续低延迟时窗口持续增长', () => {
  const cc = new UtpCongestionControl(1, 100)
  const initial = cc.getWindowSize()
  for (let i = 0; i < 5; i++) {
    cc.updateRtt(10) // 始终低延迟
  }
  assertGreater(cc.getWindowSize(), initial, '连续低延迟后窗口应比初始更大')
})
