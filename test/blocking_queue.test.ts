import { BlockingQueue } from '../src/blocking_queue.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('BlockingQueue enqueue and dequeue test', async () => {
  const queue = new BlockingQueue<number>(3)

  // Enqueue 3 items
  await queue.enqueue(1)
  await queue.enqueue(2)
  await queue.enqueue(3)

  // Dequeue 3 items
  assertEquals(await queue.dequeue(), 1)
  assertEquals(await queue.dequeue(), 2)
  assertEquals(await queue.dequeue(), 3)
})

Deno.test('BlockingQueue size test', async () => {
  const queue = new BlockingQueue<number>(3)

  assertEquals(queue.size(), 0)

  await queue.enqueue(1)
  assertEquals(queue.size(), 1)

  await queue.enqueue(2)
  assertEquals(queue.size(), 2)

  await queue.enqueue(3)
  assertEquals(queue.size(), 3)
})

Deno.test('BlockingQueue leftCapacity test', async () => {
  const queue = new BlockingQueue<number>(3)

  assertEquals(queue.leftCapacity(), 3)

  await queue.enqueue(1)
  assertEquals(queue.leftCapacity(), 2)

  await queue.enqueue(2)
  assertEquals(queue.leftCapacity(), 1)

  await queue.enqueue(3)
  assertEquals(queue.leftCapacity(), 0)
})

Deno.test('BlockingQueue isFull test', async () => {
  const queue = new BlockingQueue<number>(3)

  assertEquals(queue.isFull(), false)

  await queue.enqueue(1)
  assertEquals(queue.isFull(), false)

  await queue.enqueue(2)
  assertEquals(queue.isFull(), false)

  await queue.enqueue(3)
  assertEquals(queue.isFull(), true)
})

Deno.test('BlockingQueue isEmpty test', async () => {
  const queue = new BlockingQueue<number>(3)

  assertEquals(queue.isEmpty(), true)

  await queue.enqueue(1)
  assertEquals(queue.isEmpty(), false)

  await queue.enqueue(2)
  assertEquals(queue.isEmpty(), false)

  await queue.enqueue(3)
  assertEquals(queue.isEmpty(), false)

  await queue.dequeue()
  assertEquals(queue.isEmpty(), false)

  await queue.dequeue()
  assertEquals(queue.isEmpty(), false)

  await queue.dequeue()
  assertEquals(queue.isEmpty(), true)
})

Deno.test('BlockingQueue clear test', async () => {
  const queue = new BlockingQueue<number>(3)

  await queue.enqueue(1)
  await queue.enqueue(2)
  await queue.enqueue(3)

  queue.clear()

  assertEquals(queue.size(), 0)
  assertEquals(queue.leftCapacity(), 3)
  assertEquals(queue.isFull(), false)
  assertEquals(queue.isEmpty(), true)
})
