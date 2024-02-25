export class BlockingMap<K, V> implements IterableIterator<[K, V]> {
  #map: Map<K, V>
  #capacity: number
  #waitingSetters: Array<[K, V, (value: void) => void]> = []

  constructor(capacity: number) {
    this.#map = new Map()
    this.#capacity = capacity
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#map[Symbol.iterator]()
  }

  next(...args: [] | [undefined]): IteratorResult<[K, V], unknown> {
    return this.#map[Symbol.iterator]().next(...args)
  }

  // 如果已满，则等待
  async set(key: K, value: V): Promise<void> {
    if (this.#map.size < this.#capacity) {
      this.#map.set(key, value)
      this.resolveNextSetter()
    } else {
      // 等待直到有空间可用
      await new Promise<void>((resolve) => {
        this.#waitingSetters.push([key, value, resolve])
      })
    }
  }

  get size(): number {
    return this.#map.size
  }

  get capacity(): number {
    return this.#capacity
  }

  get(key: K): V | undefined {
    return this.#map.get(key)
  }

  has(key: K): boolean {
    return this.#map.has(key)
  }

  delete(key: K): boolean {
    const result = this.#map.delete(key)
    if (result) {
      this.resolveNextSetter()
    }
    return result
  }

  values(): IterableIterator<V> {
    return this.#map.values()
  }

  keys(): IterableIterator<K> {
    return this.#map.keys()
  }

  clear(): void {
    this.#map.clear()
  }

  // 更新最大尺寸并解决等待中的setter（如果有空间的话）
  updateCapacity(capacity: number): void {
    this.#capacity = capacity
    this.resolveNextSetter()
  }

  private resolveNextSetter() {
    while (this.#waitingSetters.length > 0 && this.#map.size < this.#capacity) {
      const [key, value, resolve] = this.#waitingSetters.shift()!
      this.#map.set(key, value)
      resolve()
    }
  }
}
