/**
 * 阻塞队列
 * Blocking Queue
 */
export class BlockingQueue<T> {
  private queue: Array<T>
  private maxSize: number
  private resolveWaiting: ((value: Promise<void> | void) => void) | null = null

  constructor(maxSize: number) {
    this.maxSize = maxSize
    this.queue = new Array<T>()
  }

  // 添加元素到队列，如果队列满了，则等待
  // add an element to the queue, if the queue is full, wait
  async enqueue(item: T): Promise<void> {
    // 如果队列已满，则等待
    // if the queue is full, wait
    while (this.isFull()) {
      await new Promise<void>((resolve) => {
        this.resolveWaiting = resolve
      })
    }

    this.queue.push(item)

    // 如果有消费者在等待，则通知其可以继续消费
    // if there is a consumer waiting, notify it that it can continue to consume
    if (this.resolveWaiting) {
      this.resolveWaiting()
      this.resolveWaiting = null
    }
  }

  // 从队列中移除并返回一个元素，如果队列为空，则等待
  // remove and return an element from the queue, if the queue is empty, wait
  async dequeue(): Promise<T> {
    // 如果队列为空，则等待
    // if the queue is empty, wait
    while (this.isEmpty()) {
      await new Promise<void>((resolve) => {
        this.resolveWaiting = resolve
      })
    }

    const item = this.queue.shift()!

    // 如果有生产者在等待，则通知其可以继续生产
    // if there is a producer waiting, notify it that it can continue to produce
    if (this.resolveWaiting) {
      this.resolveWaiting()
      this.resolveWaiting = null
    }

    return item
  }

  size(): number {
    return this.queue.length
  }

  leftCapacity(): number {
    return this.maxSize - this.queue.length
  }

  isFull(): boolean {
    return this.queue.length >= this.maxSize
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }

  clear(): void {
    this.queue = []
  }
}
