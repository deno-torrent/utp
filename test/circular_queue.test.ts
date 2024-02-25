import { CircularQueue } from '../src/circular_queue.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('CircularQueue basic operations test', () => {
  const queue = new CircularQueue<string>(3)

  // 测试初始状态
  assertEquals(queue.size, 0)
  assertEquals(queue.capacity, 3)
  assertEquals(queue.isEmpty(), true)
  assertEquals(queue.isAtCapacity(), false)

  // 测试入队
  queue.enqueue(1, 'one')
  assertEquals(queue.size, 1)
  assertEquals(queue.has(1), true)
  assertEquals(queue.isEmpty(), false)

  // 测试出队
  const item = queue.dequeueByKey(1)
  assertEquals(item, 'one')
  assertEquals(queue.size, 0)
  assertEquals(queue.has(1), false)
  assertEquals(queue.isEmpty(), true)
})

Deno.test('CircularQueue capacity test', () => {
  const queue = new CircularQueue<string>(2)

  // 填充到容量上限
  queue.enqueue(1, 'one')
  queue.enqueue(2, 'two')
  assertEquals(queue.size, 2)
  assertEquals(queue.isAtCapacity(), true)

  // 添加新项，应该移除最旧的项
  queue.enqueue(3, 'three')
  assertEquals(queue.size, 2)
  assertEquals(queue.has(1), false)
  assertEquals(queue.has(2), true)
  assertEquals(queue.has(3), true)
})

Deno.test('CircularQueue key operations test', () => {
  const queue = new CircularQueue<string>(3)

  // 添加测试数据
  queue.enqueue(2, 'two')
  queue.enqueue(1, 'one')
  queue.enqueue(3, 'three')

  // 测试键操作
  assertEquals(queue.minKey(), 1)
  assertEquals(queue.maxKey(), 3)
  assertEquals(queue.keys(), [1, 2, 3])
})

Deno.test('CircularQueue update existing key test', () => {
  const queue = new CircularQueue<string>(3)

  // 添加初始数据
  queue.enqueue(1, 'one')
  const item1 = queue.dequeueByKey(1)
  assertEquals(item1, 'one')

  // 更新已存在的键
  queue.enqueue(1, 'ONE')
  const item2 = queue.dequeueByKey(1)
  assertEquals(item2, 'ONE')
  assertEquals(queue.size, 0) // 大小应该为 0，因为我们已经取出了所有项
})

Deno.test('CircularQueue clear test', () => {
  const queue = new CircularQueue<string>(3)

  // 添加测试数据
  queue.enqueue(1, 'one')
  queue.enqueue(2, 'two')
  assertEquals(queue.size, 2)

  // 清空队列
  queue.clear()
  assertEquals(queue.size, 0)
  assertEquals(queue.isEmpty(), true)
  assertEquals(queue.has(1), false)
  assertEquals(queue.has(2), false)
}) 