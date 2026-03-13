export class Statistic {
  #ONE_SECOND = 1000
  #sentData: number = 0
  #recvData: number = 0
  #sentDataInLastSecond: number = 0
  #recvDataInLastSecond: number = 0
  #totalSentSpeedAccumulator: number = 0
  #totalRecvSpeedAccumulator: number = 0
  #sentSpeedMeasurements: number = 0
  #recvSpeedMeasurements: number = 0
  #maxSentSpeed: number = 0
  #minSentSpeed: number = Number.POSITIVE_INFINITY
  #maxRecvSpeed: number = 0
  #minRecvSpeed: number = Number.POSITIVE_INFINITY
  #intervalId: ReturnType<typeof setInterval> | null = null
  #started: boolean = false

  // Sent data getters
  get totalSentData(): number {
    return this.#sentData
  }

  get averageSentSpeed(): number {
    return this.#sentSpeedMeasurements > 0 ? this.#totalSentSpeedAccumulator / this.#sentSpeedMeasurements : 0
  }

  get maxSentSpeed(): number {
    return this.#maxSentSpeed
  }

  get minSentSpeed(): number {
    return this.#minSentSpeed === Number.POSITIVE_INFINITY ? 0 : this.#minSentSpeed
  }

  get lastSentSpeed(): number {
    return this.#sentDataInLastSecond
  }

  // Received data getters
  get totalRecvData(): number {
    return this.#recvData
  }

  get averageRecvSpeed(): number {
    return this.#recvSpeedMeasurements > 0 ? this.#totalRecvSpeedAccumulator / this.#recvSpeedMeasurements : 0
  }

  get maxRecvSpeed(): number {
    return this.#maxRecvSpeed
  }

  get minRecvSpeed(): number {
    return this.#minRecvSpeed === Number.POSITIVE_INFINITY ? 0 : this.#minRecvSpeed
  }

  get lastRecvSpeed(): number {
    return this.#recvDataInLastSecond
  }

  // Update methods
  updateSentData(amount: number) {
    if (!this.#started) {
      this.startSpeedMeasurement()
    }
    this.#sentData += amount
    this.#sentDataInLastSecond += amount
  }

  updateRecvData(amount: number) {
    if (!this.#started) {
      this.startSpeedMeasurement()
    }
    this.#recvData += amount
    this.#recvDataInLastSecond += amount
  }

  // Speed measurement
  startSpeedMeasurement() {
    if (this.#started) {
      return
    }

    this.#started = true

    // Clear any existing interval
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId)
    }

    // Set up a new interval
    this.#intervalId = setInterval(() => {
      // Calculate speed for the last second
      const sentSpeedThisSecond = this.#sentDataInLastSecond
      const recvSpeedThisSecond = this.#recvDataInLastSecond

      if (sentSpeedThisSecond > 0) {
        // Update max and min sent speeds
        this.#maxSentSpeed = Math.max(this.#maxSentSpeed, sentSpeedThisSecond)
        this.#minSentSpeed = this.#minSentSpeed === Number.POSITIVE_INFINITY ? sentSpeedThisSecond : Math.min(this.#minSentSpeed, sentSpeedThisSecond)
        // Update average sent speed
        this.#totalSentSpeedAccumulator += sentSpeedThisSecond
        this.#sentSpeedMeasurements++
      }

      if (recvSpeedThisSecond > 0) {
        // Update max and min received speeds
        this.#maxRecvSpeed = Math.max(this.#maxRecvSpeed, recvSpeedThisSecond)
        this.#minRecvSpeed = this.#minRecvSpeed === Number.POSITIVE_INFINITY ? recvSpeedThisSecond : Math.min(this.#minRecvSpeed, recvSpeedThisSecond)
        // Update average received speed
        this.#totalRecvSpeedAccumulator += recvSpeedThisSecond
        this.#recvSpeedMeasurements++
      }

      // Reset the counts for the next second
      this.#sentDataInLastSecond = 0
      this.#recvDataInLastSecond = 0
    }, this.#ONE_SECOND)
  }

  // Clear all statistics
  clear() {
    this.release()
    this.#sentData = 0
    this.#recvData = 0
    this.#sentDataInLastSecond = 0
    this.#recvDataInLastSecond = 0
    this.#totalSentSpeedAccumulator = 0
    this.#totalRecvSpeedAccumulator = 0
    this.#sentSpeedMeasurements = 0
    this.#recvSpeedMeasurements = 0
    this.#maxSentSpeed = 0
    this.#maxRecvSpeed = 0
    this.#minSentSpeed = Number.POSITIVE_INFINITY
    this.#minRecvSpeed = Number.POSITIVE_INFINITY
  }

  release() {
    // Clear the existing interval
    if (this.#intervalId !== null) {
      clearInterval(this.#intervalId)
      this.#intervalId = null
      this.#started = false
    }
  }
}
