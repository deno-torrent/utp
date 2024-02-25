import { TimerManager } from '../src/timer_manager.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('TimerManager basic timer operations test', async () => {
  let counter = 0
  const callback = () => { counter++ }

  // 设置定时器
  TimerManager.setTimer('test', callback, 100)
  assertEquals(TimerManager.exist('test'), true)

  // 等待定时器执行
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter, 1)

  // 清除定时器
  TimerManager.clearTimer('test')
  assertEquals(TimerManager.exist('test'), false)

  // 等待一段时间，确认定时器已被清除
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter, 1)
})

Deno.test('TimerManager update timer test', async () => {
  let counter = 0
  const callback1 = () => { counter += 1 }
  const callback2 = () => { counter += 2 }

  // 设置第一个定时器
  TimerManager.setTimer('test', callback1, 100)
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter, 1)

  // 更新定时器
  TimerManager.setTimer('test', callback2, 100)
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter, 3) // 1 + 2

  // 清除定时器
  TimerManager.clearTimer('test')
})

Deno.test('TimerManager multiple timers test', async () => {
  let counter1 = 0
  let counter2 = 0
  const callback1 = () => { counter1++ }
  const callback2 = () => { counter2++ }

  // 设置两个定时器
  TimerManager.setTimer('test1', callback1, 100)
  TimerManager.setTimer('test2', callback2, 100)

  // 等待定时器执行
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter1, 1)
  assertEquals(counter2, 1)

  // 清除所有定时器
  TimerManager.clearAllTimers()
  assertEquals(TimerManager.exist('test1'), false)
  assertEquals(TimerManager.exist('test2'), false)

  // 等待一段时间，确认定时器已被清除
  await new Promise(resolve => setTimeout(resolve, 150))
  assertEquals(counter1, 1)
  assertEquals(counter2, 1)
})

Deno.test('TimerManager clear non-existent timer test', () => {
  // 尝试清除不存在的定时器
  TimerManager.clearTimer('non-existent')
  assertEquals(TimerManager.exist('non-existent'), false)
}) 