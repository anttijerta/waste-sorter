import { describe, expect, it } from 'vitest'
import { hashIp, utcDay, utcMonth } from '#usage/ip_hash'

const SECRET = 'not-a-real-key'
const DAY = new Date('2026-10-14T12:00:00Z')

describe('hashIp', () => {
  it('is stable for the same IP on the same UTC day', () => {
    const later = new Date('2026-10-14T23:59:59.999Z')
    expect(hashIp('198.51.100.7', SECRET, DAY)).toBe(hashIp('198.51.100.7', SECRET, later))
  })

  it('changes at UTC midnight, so days cannot be linked', () => {
    const before = new Date('2026-10-14T23:59:59.999Z')
    const after = new Date('2026-10-15T00:00:00.000Z')
    expect(hashIp('198.51.100.7', SECRET, before)).not.toBe(hashIp('198.51.100.7', SECRET, after))
  })

  it('differs for different IPs and for different keys', () => {
    expect(hashIp('198.51.100.7', SECRET, DAY)).not.toBe(hashIp('198.51.100.8', SECRET, DAY))
    expect(hashIp('198.51.100.7', SECRET, DAY)).not.toBe(hashIp('198.51.100.7', 'other', DAY))
  })

  it('is a 64-character hex digest that does not contain the IP', () => {
    const hash = hashIp('2001:db8::1', SECRET, DAY)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('2001')
  })
})

describe('utcDay and utcMonth', () => {
  it('use the UTC calendar, not local time', () => {
    const now = new Date('2026-10-31T23:30:00-02:00') // 2026-11-01T01:30Z
    expect(utcDay(now)).toBe('2026-11-01')
    expect(utcMonth(now)).toBe('2026-11')
  })
})
