export class CircularQueue<T> {
  #capacity: number
  #items: Map<number, T>
  #oldestKey?: number // Keeps track of the smallest seqNumber in the queue

  constructor(capacity: number) {
    this.#capacity = capacity
    this.#items = new Map()
    this.#oldestKey = undefined
  }

  get size(): number {
    return this.#items.size
  }

  get capacity(): number {
    return this.#capacity
  }

  keys(): Array<number> {
    // return the keys in ascending order, from smallest to largest
    return [...this.#items.keys()].sort((a, b) => a - b)
  }

  // get the maximum key
  maxKey(): number | undefined {
    if (this.isEmpty()) {
      return undefined
    }
    return Math.max(...this.#items.keys())
  }

  // get the minimum key
  minKey(): number | undefined {
    if (this.isEmpty()) {
      return undefined
    }
    return Math.min(...this.#items.keys())
  }

  has(key: number): boolean {
    return this.#items.has(key)
  }

  enqueue(key: number, item: T): void {
    // if the key is already in the queue, update the item
    if (this.#items.has(key)) {
      this.#items.set(key, item)
      return
    }

    // If we've reached capacity, remove the oldest item
    if (this.isAtCapacity()) {
      if (this.#oldestKey !== undefined) {
        this.#items.delete(this.#oldestKey)
      }
    }

    this.#items.set(key, item)
    this.updateOldestKey()
  }

  dequeueByKey(key: number): T | undefined {
    const item = this.#items.get(key)
    if (item) {
      this.#items.delete(key)
      // if the dequeued item is the oldest item, update the oldestKey
      if (key === this.#oldestKey) {
        this.updateOldestKey()
      }
    }
    return item
  }

  /**
   * find the oldest key
   * @returns
   */
  private updateOldestKey(): void {
    if (this.isEmpty()) {
      this.#oldestKey = undefined
      return
    }

    const keys = [...this.#items.keys()]
    this.#oldestKey = Math.min(...keys)
  }

  /**
   * Check if the queue is at capacity
   * @returns
   */
  isAtCapacity(): boolean {
    return this.#items.size >= this.capacity
  }

  isEmpty(): boolean {
    return this.#items.size === 0
  }

  clear(): void {
    this.#items.clear()
    this.#oldestKey = undefined
  }
}
