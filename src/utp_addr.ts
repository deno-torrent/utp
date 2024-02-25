import Util from './utilt.ts'

export class UtpAddr {
  port: number
  hostname: string

  constructor(port: number, hostname: string) {
    // check port and hostname is valid
    if (port < 0 || port > 65535) {
      throw new Error(`invalid port: ${port}`)
    }

    if (!Util.isValidHostname(hostname)) {
      throw new Error(`invalid hostname: ${hostname}`)
    }

    this.port = port
    this.hostname = hostname
  }

  static fromNetAddr(addr: Deno.NetAddr): UtpAddr {
    return new UtpAddr(addr.port, addr.hostname)
  }

  static fromDenoAddr(addr: Deno.Addr): UtpAddr {
    if ('port' in addr && 'hostname' in addr) {
      return new UtpAddr(addr.port, addr.hostname)
    }
    throw new Error('invalid addr')
  }

  toString(): string {
    return `${this.hostname}:${this.port}`
  }

  equals(addr: UtpAddr): boolean {
    return this.port === addr.port && this.hostname === addr.hostname
  }

  hashCode(): number {
    return this.port * 31 + Util.hashCode(this.hostname)
  }
}
