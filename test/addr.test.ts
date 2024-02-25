import { UtpAddr } from '../src/utp_addr.ts'
import { assertEquals } from 'std/assert/mod.ts'
Deno.test('Addr constructor test', () => {
  const addr = new UtpAddr(8080, '0.0.0.0')
  assertEquals(addr.port, 8080)
  assertEquals(addr.hostname, '0.0.0.0')
})

Deno.test('Addr toString test', () => {
  const addr = new UtpAddr(8080, '0.0.0.0')
  assertEquals(addr.toString(), '0.0.0.0:8080')
})

Deno.test('Addr equals test', () => {
  const addr1 = new UtpAddr(8080, '0.0.0.0')
  const addr2 = new UtpAddr(8080, '0.0.0.0')
  const addr3 = new UtpAddr(8081, '0.0.0.0')
  assertEquals(addr1.equals(addr2), true)
  assertEquals(addr1.equals(addr3), false)
})

Deno.test('Addr fromNetAddr test', () => {
  const netAddr: Deno.NetAddr = { transport: 'tcp', hostname: '0.0.0.0', port: 8080 }
  const addr = UtpAddr.fromNetAddr(netAddr)
  assertEquals(addr.port, netAddr.port)
  assertEquals(addr.hostname, netAddr.hostname)
})

Deno.test('Addr fromDenoAddr test', () => {
  const denoAddr: Deno.Addr = { transport: 'tcp', hostname: '0.0.0.0', port: 8080 }
  const addr = UtpAddr.fromDenoAddr(denoAddr)
  assertEquals(addr.port, denoAddr.port)
  assertEquals(addr.hostname, denoAddr.hostname)
})
