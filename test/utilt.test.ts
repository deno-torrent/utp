import Util from '../src/utilt.ts'
import { assertEquals } from 'std/assert/mod.ts'

Deno.test('Util randomUn16Int test', () => {
  const num = Util.randomUn16Int()
  assertEquals(typeof num, 'number')
  assertEquals(num >= 0 && num < 65535, true)
})

Deno.test('Util currentMicroseconds test', () => {
  const now = Date.now()
  const micros = Util.currentMicroseconds()
  assertEquals(typeof micros, 'number')
  assertEquals(micros >= now * 1000, true)
})

Deno.test('Util isValidHostname test', () => {
  // 测试有效的域名
  assertEquals(Util.isValidHostname('example.com'), true)
  assertEquals(Util.isValidHostname('sub.example.com'), true)
  assertEquals(Util.isValidHostname('example.co.uk'), true)

  // 测试有效的 IP 地址
  assertEquals(Util.isValidHostname('192.168.1.1'), true)
  assertEquals(Util.isValidHostname('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true)

  // 测试无效的主机名
  assertEquals(Util.isValidHostname(''), false)
  assertEquals(Util.isValidHostname('invalid..domain'), false)
  assertEquals(Util.isValidHostname('256.256.256.256'), true)
})

Deno.test('Util isIPv4 test', () => {
  // 测试有效的 IPv4 地址
  assertEquals(Util.isIPv4('192.168.1.1'), true)
  assertEquals(Util.isIPv4('0.0.0.0'), true)
  assertEquals(Util.isIPv4('255.255.255.255'), true)

  // 测试无效的 IPv4 地址
  assertEquals(Util.isIPv4('256.1.2.3'), false)
  assertEquals(Util.isIPv4('1.2.3'), false)
  assertEquals(Util.isIPv4('1.2.3.4.5'), false)
  assertEquals(Util.isIPv4('192.168.1'), false)
})

Deno.test('Util isIPv6 test', () => {
  // 测试有效的 IPv6 地址
  assertEquals(Util.isIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true)
  assertEquals(Util.isIPv6('fe80::1ff:fe23:4567:890a'), true)

  // 测试无效的 IPv6 地址
  assertEquals(Util.isIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334:extra'), false)
  assertEquals(Util.isIPv6('2001:0db8:85a3:0000:0000:8a2e:0370'), false)
})

Deno.test('Util isDomain test', () => {
  // 测试有效的域名
  assertEquals(Util.isDomain('example.com'), true)
  assertEquals(Util.isDomain('sub.example.com'), true)
  assertEquals(Util.isDomain('example.co.uk'), true)

  // 测试无效的域名
  assertEquals(Util.isDomain(''), false)
  assertEquals(Util.isDomain('invalid..domain'), false)
  assertEquals(Util.isDomain('.example.com'), false)
  assertEquals(Util.isDomain('example.com.'), false)
})

Deno.test('Util hashCode test', () => {
  // 测试相同字符串产生相同的哈希值
  const str1 = 'test'
  const str2 = 'test'
  assertEquals(Util.hashCode(str1), Util.hashCode(str2))

  // 测试不同字符串产生不同的哈希值
  const str3 = 'test1'
  const str4 = 'test2'
  assertEquals(Util.hashCode(str3) !== Util.hashCode(str4), true)

  // 测试空字符串
  assertEquals(Util.hashCode(''), 0)
})
