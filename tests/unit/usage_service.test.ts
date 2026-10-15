import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database } from '@adonisjs/lucid/database'
import UsageService from '#usage/usage_service'
import { createDatabase } from './test_database.js'

// Integer micro-euros
const ESTIMATE = 3125

describe('UsageService', () => {
  let db: Database

  beforeEach(async () => {
    db = await createDatabase()
  })

  afterEach(async () => {
    await db.manager.closeAll()
  })

  it('never reserves past the monthly cap, even for concurrent requests', async () => {
    // Room for exactly 3 reservations.
    const usage = new UsageService(db, {
      perIpPerMinute: 100,
      perIpDaily: 100,
      monthlyCapMicroEur: ESTIMATE * 3 + 1000,
    })

    // Started in the same tick: without one transaction around the check
    // and the insert, all ten would read zero spend and be accepted.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => usage.reserve(`hash-${i}`, ESTIMATE))
    )

    expect(results.filter((result) => result.ok)).toHaveLength(3)
    expect(results.filter((result) => !result.ok && result.reason === 'monthly_cap')).toHaveLength(
      7
    )
  })

  it('applies the per-minute and daily limits to one IP hash only', async () => {
    const usage = new UsageService(db, {
      perIpPerMinute: 2,
      perIpDaily: 3,
      monthlyCapMicroEur: 100_000_000,
    })
    const now = new Date('2026-10-14T12:00:00Z')
    const later = new Date('2026-10-14T12:01:30Z')

    expect(await usage.reserve('a', ESTIMATE, now)).toMatchObject({ ok: true })
    expect(await usage.reserve('a', ESTIMATE, now)).toMatchObject({ ok: true })
    expect(await usage.reserve('a', ESTIMATE, now)).toEqual({ ok: false, reason: 'per_minute' })
    expect(await usage.reserve('b', ESTIMATE, now)).toMatchObject({ ok: true })

    // A minute later the per-minute window is free, but the day has 1 left.
    expect(await usage.reserve('a', ESTIMATE, later)).toMatchObject({ ok: true })
    expect(await usage.reserve('a', ESTIMATE, later)).toEqual({ ok: false, reason: 'daily' })
  })

  it('settles a reservation to the real cost, freeing budget', async () => {
    const usage = new UsageService(db, {
      perIpPerMinute: 100,
      perIpDaily: 100,
      monthlyCapMicroEur: Math.floor(ESTIMATE * 1.5),
    })

    const first = await usage.reserve('a', ESTIMATE)
    expect(first.ok).toBe(true)
    expect(await usage.reserve('b', ESTIMATE)).toEqual({ ok: false, reason: 'monthly_cap' })

    await usage.settle((first as { id: number }).id, Math.floor(ESTIMATE / 4), null)
    expect(await usage.reserve('b', ESTIMATE)).toMatchObject({ ok: true })
  })

  it('deletes rows older than 35 days', async () => {
    const usage = new UsageService(db, {
      perIpPerMinute: 100,
      perIpDaily: 100,
      monthlyCapMicroEur: 100_000_000,
    })
    const old = new Date('2026-08-01T12:00:00Z')
    const now = new Date('2026-10-14T12:00:00Z')

    await usage.reserve('a', ESTIMATE, old)
    await usage.reserve('a', ESTIMATE, now)

    const rows = await db.from('usage_events').select('created_at_ms')
    expect(rows.map((row) => Number(row.created_at_ms))).toEqual([now.getTime()])
  })
})
