import { BlockingMap } from '../src/blocking_map.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('BlockingMap basic operations test', async () => {
  const map = new BlockingMap<string, number>(3)

  // 测试初始状态
  assertEquals(map.size, 0)
  assertEquals(map.capacity, 3)

  // 测试设置和获取
  await map.set('key1', 1)
  assertEquals(map.get('key1'), 1)
  assertEquals(map.has('key1'), true)
  assertEquals(map.size, 1)

  // 测试删除
  assertEquals(map.delete('key1'), true)
  assertEquals(map.has('key1'), false)
  assertEquals(map.size, 0)
})

Deno.test('BlockingMap capacity limit test', async () => {
  const map = new BlockingMap<string, number>(2)

  // 填充到容量上限
  await map.set('key1', 1)
  await map.set('key2', 2)
  assertEquals(map.size, 2)

  // 尝试在已满时设置新值
  const setPromise = map.set('key3', 3)
  
  // 删除一个值，应该触发等待的设置操作
  assertEquals(map.delete('key1'), true)
  
  // 等待设置操作完成
  await setPromise
  assertEquals(map.get('key3'), 3)
  assertEquals(map.size, 2)
})

Deno.test('BlockingMap update capacity test', async () => {
  const map = new BlockingMap<string, number>(2)

  // 填充到容量上限
  await map.set('key1', 1)
  await map.set('key2', 2)
  assertEquals(map.size, 2)

  // 尝试在已满时设置新值
  const setPromise = map.set('key3', 3)
  
  // 增加容量，应该触发等待的设置操作
  map.updateCapacity(3)
  
  // 等待设置操作完成
  await setPromise
  assertEquals(map.get('key3'), 3)
  assertEquals(map.size, 3)
})

Deno.test('BlockingMap iteration test', async () => {
  const map = new BlockingMap<string, number>(3)

  // 添加测试数据
  await map.set('key1', 1)
  await map.set('key2', 2)
  await map.set('key3', 3)

  // 测试迭代器
  const entries = Array.from(map)
  assertEquals(entries.length, 3)
  assertEquals(entries, [['key1', 1], ['key2', 2], ['key3', 3]])

  // 测试 keys
  const keys = Array.from(map.keys())
  assertEquals(keys, ['key1', 'key2', 'key3'])

  // 测试 values
  const values = Array.from(map.values())
  assertEquals(values, [1, 2, 3])
})

Deno.test('BlockingMap clear test', async () => {
  const map = new BlockingMap<string, number>(3)

  // 添加测试数据
  await map.set('key1', 1)
  await map.set('key2', 2)
  assertEquals(map.size, 2)

  // 清空地图
  map.clear()
  assertEquals(map.size, 0)
  assertEquals(map.get('key1'), undefined)
  assertEquals(map.get('key2'), undefined)
}) 