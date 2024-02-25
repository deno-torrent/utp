import { UtpAddr } from '../src/utp_addr.ts'
import { assertEquals, assertThrows } from 'std/assert/mod.ts'

Deno.test('UtpAddr constructor test', () => {
  // 测试有效的地址创建
  const addr = new UtpAddr(8080, 'localhost')
  assertEquals(addr.port, 8080)
  assertEquals(addr.hostname, 'localhost')

  // 测试无效端口
  assertThrows(() => new UtpAddr(-1, 'localhost'), Error, 'invalid port: -1')
  assertThrows(() => new UtpAddr(65536, 'localhost'), Error, 'invalid port: 65536')

  // 测试无效主机名
  assertThrows(() => new UtpAddr(8080, ''), Error, 'invalid hostname: ')
  assertThrows(() => new UtpAddr(8080, 'invalid..hostname'), Error, 'invalid hostname: invalid..hostname')
})

Deno.test('UtpAddr fromNetAddr test', () => {
  const netAddr: Deno.NetAddr = {
    hostname: '127.0.0.1',
    port: 8080,
    transport: 'tcp'
  }

  const addr = UtpAddr.fromNetAddr(netAddr)
  assertEquals(addr.port, 8080)
  assertEquals(addr.hostname, '127.0.0.1')
})

Deno.test('UtpAddr fromDenoAddr test', () => {
  // 测试有效的 Deno.Addr
  const validAddr: Deno.NetAddr = {
    hostname: '127.0.0.1',
    port: 8080,
    transport: 'tcp'
  }
  const addr = UtpAddr.fromDenoAddr(validAddr)
  assertEquals(addr.port, 8080)
  assertEquals(addr.hostname, '127.0.0.1')

  // 测试无效的 Deno.Addr
  const invalidAddr: Deno.UnixAddr = {
    path: '/tmp/socket',
    transport: 'unix'
  }
  assertThrows(() => UtpAddr.fromDenoAddr(invalidAddr), Error, 'invalid addr')
})

Deno.test('UtpAddr toString test', () => {
  const addr = new UtpAddr(8080, 'localhost')
  assertEquals(addr.toString(), 'localhost:8080')
})

Deno.test('UtpAddr equals test', () => {
  const addr1 = new UtpAddr(8080, 'localhost')
  const addr2 = new UtpAddr(8080, 'localhost')
  const addr3 = new UtpAddr(8081, 'localhost')
  const addr4 = new UtpAddr(8080, '127.0.0.1')

  assertEquals(addr1.equals(addr2), true)
  assertEquals(addr1.equals(addr3), false)
  assertEquals(addr1.equals(addr4), false)
})

Deno.test('UtpAddr hashCode test', () => {
  const addr1 = new UtpAddr(8080, 'localhost')
  const addr2 = new UtpAddr(8080, 'localhost')
  const addr3 = new UtpAddr(8081, 'localhost')
  const addr4 = new UtpAddr(8080, '127.0.0.1')

  assertEquals(addr1.hashCode(), addr2.hashCode())
  assertEquals(addr1.hashCode() !== addr3.hashCode(), true)
  assertEquals(addr1.hashCode() !== addr4.hashCode(), true)
})
