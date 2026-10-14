import { describe, expect, it } from 'vitest'
import { compileTrustedProxies } from '#app_http/trusted_proxies'

describe('compileTrustedProxies', () => {
  it('trusts nobody when empty, not even loopback', () => {
    const trust = compileTrustedProxies('')
    expect(trust('127.0.0.1', 0)).toBe(false)
    expect(trust('172.18.0.2', 0)).toBe(false)
  })

  it('trusts only the configured proxy subnet', () => {
    const trust = compileTrustedProxies(' 172.30.0.0/24 , 10.0.0.5 ')
    expect(trust('172.30.0.10', 0)).toBe(true)
    expect(trust('10.0.0.5', 0)).toBe(true)
    expect(trust('172.30.1.10', 0)).toBe(false)
    expect(trust('203.0.113.9', 0)).toBe(false)
  })

  it('trusts an IPv4-mapped IPv6 address from the configured subnet', () => {
    // A dual-stack socket reports IPv4 peers as ::ffff:a.b.c.d
    const trust = compileTrustedProxies('172.30.0.0/24')
    expect(trust('::ffff:172.30.0.10', 0)).toBe(true)
    expect(trust('::ffff:172.30.1.10', 0)).toBe(false)
  })
})
