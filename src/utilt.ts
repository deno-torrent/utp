function randomUn16Int(): number {
  return Math.floor(Math.random() * 65535)
}

function currentMicroseconds(): number {
  return Date.now() * 1000
}

function isValidHostname(hostname: string): boolean {
  if (!hostname) return false
  if (hostname === 'localhost') return true
  return isIPv4(hostname) || isIPv6(hostname) || isDomain(hostname)
}

function isIPv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4) return false

  return parts.every(part => {
    const num = parseInt(part, 10)
    return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString()
  })
}

function isIPv6(hostname: string): boolean {
  // 移除方括号（如果存在）
  hostname = hostname.replace(/^\[|\]$/g, '')

  // 检查是否包含双冒号
  const hasDoubleColon = hostname.includes('::')
  if (hasDoubleColon) {
    // 确保只有一个双冒号
    if ((hostname.match(/::/g) || []).length > 1) return false

    // 替换双冒号为一个特殊标记
    const parts = hostname.split('::')
    if (parts.length > 2) return false

    const before = parts[0] ? parts[0].split(':') : []
    const after = parts[1] ? parts[1].split(':') : []

    // 计算需要补充的零段数
    const missing = 8 - (before.length + after.length)
    if (missing < 0) return false

    // 验证每个部分
    return [...before, ...after].every(part => /^[0-9a-fA-F]{1,4}$/.test(part))
  } else {
    // 没有压缩的情况
    const parts = hostname.split(':')
    if (parts.length !== 8) return false
    return parts.every(part => /^[0-9a-fA-F]{1,4}$/.test(part))
  }
}

function isDomain(hostname: string): boolean {
  if (!hostname || hostname.length > 255) return false

  // 检查每个标签的长度和格式
  const labels = hostname.split('.')
  if (labels.length < 2) return false

  // 检查是否有连续的点和以点开头或结尾的域名
  if (hostname.startsWith('.') || hostname.endsWith('.') || hostname.includes('..')) return false

  return labels.every(label => {
    if (!label || label.length > 63) return false
    // 标签必须以字母数字开头和结尾，中间可以包含连字符
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
  })
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return hash
}

const Util = {
  isDomain,
  randomUn16Int,
  currentMicroseconds,
  isValidHostname,
  hashCode,
  isIPv4,
  isIPv6
}

export default Util

/**
 * 16-bit 序列号回绕安全算术工具
 * 协议序列号为 uint16（0-65535），所有比较必须使用此工具以正确处理回绕。
 * 判断方法：若 (b - a) & 0xFFFF < 0x8000，则认为 a 在 b 之前（a < b）。
 */
export const Seq = {
  /** (a + n) mod 65536，n 可为负数 */
  add(a: number, n: number): number {
    return (a + n) & 0xFFFF
  },
  /** (a - b) mod 65536，即 a 相对 b 的正向距离 */
  diff(a: number, b: number): number {
    return (a - b) & 0xFFFF
  },
  /** a < b（回绕安全） */
  lt(a: number, b: number): boolean {
    return a !== b && ((b - a) & 0xFFFF) < 0x8000
  },
  /** a <= b（回绕安全） */
  le(a: number, b: number): boolean {
    return a === b || Seq.lt(a, b)
  },
  /** a > b（回绕安全） */
  gt(a: number, b: number): boolean {
    return Seq.lt(b, a)
  },
  /** a >= b（回绕安全） */
  ge(a: number, b: number): boolean {
    return a === b || Seq.gt(a, b)
  },
}
