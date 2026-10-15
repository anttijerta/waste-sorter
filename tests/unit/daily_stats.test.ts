import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database } from '@adonisjs/lucid/database'
import { CATEGORY_IDS } from '#config/categories'
import { type ClassificationOutcome, formatDailyStats, readDailyStats } from '#usage/daily_stats'
import UsageService from '#usage/usage_service'
import { createDatabase } from './test_database.js'

const ESTIMATE = 3125
const DAY = new Date('2026-10-15T12:00:00Z')

const outcome = (
  a: ClassificationOutcome['models'][number]['category'],
  b: ClassificationOutcome['models'][number]['category'],
  failed: [boolean, boolean] = [false, false]
): ClassificationOutcome => ({
  agreed: a === b && !failed[0] && !failed[1],
  models: [
    { modelId: 'gpt-6-luna', category: a, failed: failed[0] },
    { modelId: 'gpt-6.1-sol', category: b, failed: failed[1] },
  ],
})

async function reserveAndSettle(
  usage: UsageService,
  ip: string,
  cost: number,
  result: ClassificationOutcome | null,
  now = DAY
) {
  const reservation = await usage.reserve(ip, ESTIMATE, now)
  if (!reservation.ok) throw new Error(`refused: ${reservation.reason}`)
  await usage.settle(reservation.id, cost, result)
}

describe('daily statistics', () => {
  let db: Database
  const limits = { perIpPerMinute: 100, perIpDaily: 100, monthlyCapMicroEur: 100_000_000 }

  beforeEach(async () => {
    db = await createDatabase()
  })

  afterEach(async () => {
    await db.manager.closeAll()
  })

  it('counts images, agreements, errors, cost and categories per model', async () => {
    const usage = new UsageService(db, limits)
    await reserveAndSettle(usage, 'a', 2500, outcome('glass', 'glass'))
    await reserveAndSettle(usage, 'b', 3000, outcome('paper', 'cardboard'))
    await reserveAndSettle(usage, 'a', 1200, outcome('unrecognized', 'glass', [true, false]))

    const [today] = await readDailyStats(db, 30)
    expect(today).toEqual({
      day: '2026-10-15',
      images: 3,
      agreements: 1,
      errors: 1,
      rejectedPerMinute: 0,
      rejectedDaily: 0,
      rejectedMonthlyCap: 0,
      costMicroEur: 6700,
      categories: {
        'gpt-6-luna': { glass: 1, paper: 1, unrecognized: 1 },
        'gpt-6.1-sol': { glass: 2, cardboard: 1 },
      },
    })
  })

  it('counts a request that failed as a whole as an image with one error', async () => {
    const usage = new UsageService(db, limits)
    await reserveAndSettle(usage, 'a', ESTIMATE, null)
    const [today] = await readDailyStats(db, 30)
    expect(today).toMatchObject({ images: 1, errors: 1, costMicroEur: ESTIMATE, categories: {} })
  })

  it('counts rejected requests by limit type, without a usage row', async () => {
    const usage = new UsageService(db, {
      perIpPerMinute: 2,
      perIpDaily: 3,
      monthlyCapMicroEur: ESTIMATE * 5,
    })
    const later = new Date(DAY.getTime() + 90_000)

    // per minute: the third request within a minute
    await reserveAndSettle(usage, 'a', ESTIMATE, outcome('glass', 'glass'))
    await reserveAndSettle(usage, 'a', ESTIMATE, outcome('glass', 'glass'))
    expect(await usage.reserve('a', ESTIMATE, DAY)).toEqual({ ok: false, reason: 'per_minute' })
    // daily: the fourth request of the day, a minute later
    await reserveAndSettle(usage, 'a', ESTIMATE, outcome('glass', 'glass'), later)
    expect(await usage.reserve('a', ESTIMATE, later)).toEqual({ ok: false, reason: 'daily' })
    // monthly cap: 3 settled at the estimate, 2 more fit, then the cap
    await reserveAndSettle(usage, 'b', ESTIMATE, outcome('glass', 'glass'), later)
    await reserveAndSettle(usage, 'c', ESTIMATE, outcome('glass', 'glass'), later)
    expect(await usage.reserve('d', ESTIMATE, later)).toEqual({ ok: false, reason: 'monthly_cap' })

    const [today] = await readDailyStats(db, 30)
    expect(today).toMatchObject({
      images: 5,
      rejectedPerMinute: 1,
      rejectedDaily: 1,
      rejectedMonthlyCap: 1,
    })
    const usageRows = await db.from('usage_events').count('* as total').first()
    expect(Number(usageRows.total)).toBe(5)
  })

  it('counts concurrent rejections exactly, in the reservation transaction', async () => {
    const usage = new UsageService(db, { ...limits, monthlyCapMicroEur: ESTIMATE * 3 })
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => usage.reserve(`ip-${i}`, ESTIMATE, DAY))
    )
    expect(results.filter((r) => r.ok)).toHaveLength(3)
    const [today] = await readDailyStats(db, 30)
    expect(today.rejectedMonthlyCap).toBe(7)
  })

  it('counts on the reservation day, even when settled after midnight', async () => {
    const usage = new UsageService(db, limits)
    const reservation = await usage.reserve('a', ESTIMATE, new Date('2026-10-15T23:59:59Z'))
    if (!reservation.ok) throw new Error('refused')
    // settle() does not take a clock: the day comes from the reservation
    await usage.settle(reservation.id, 1000, outcome('glass', 'glass'))
    const rows = await readDailyStats(db, 30)
    expect(rows.map((r) => [r.day, r.images])).toEqual([['2026-10-15', 1]])
  })

  it('rolls back the settled cost if the statistics cannot be written', async () => {
    const usage = new UsageService(db, limits)
    const reservation = await usage.reserve('a', ESTIMATE, DAY)
    if (!reservation.ok) throw new Error('refused')
    await db.rawQuery('DROP TABLE daily_category_counts')

    await expect(usage.settle(reservation.id, 1000, outcome('glass', 'glass'))).rejects.toThrow()
    const row = await db.from('usage_events').where('id', reservation.id).first()
    expect(Number(row.cost_micro_eur)).toBe(ESTIMATE)
    const stats = await db.from('daily_stats').first()
    expect(stats ?? null).toBeNull()
  })

  it('keeps daily statistics when old usage rows are deleted', async () => {
    const usage = new UsageService(db, limits)
    const old = new Date('2026-08-01T12:00:00Z')
    await reserveAndSettle(usage, 'a', 500, outcome('glass', 'glass'), old)
    // A reservation 75 days later triggers the 35-day cleanup
    await reserveAndSettle(usage, 'a', 700, outcome('paper', 'paper'), DAY)

    const usageDays = await db.from('usage_events').select('day')
    expect(usageDays.map((r) => r.day)).toEqual(['2026-10-15'])
    const stats = await readDailyStats(db, 30)
    expect(stats.map((r) => [r.day, r.images, r.costMicroEur])).toEqual([
      ['2026-10-15', 1, 700],
      ['2026-08-01', 1, 500],
    ])
  })

  it('stores no visitor data', async () => {
    const usage = new UsageService(db, limits)
    await reserveAndSettle(usage, 'secret-ip-hash', 500, outcome('glass', 'glass'))
    const dump = JSON.stringify([
      await db.from('daily_stats').select('*'),
      await db.from('daily_category_counts').select('*'),
    ])
    expect(dump).not.toContain('secret-ip-hash')
  })

  it('formats one table per day and one per day and model', async () => {
    const usage = new UsageService(db, limits)
    await reserveAndSettle(usage, 'a', 2500, outcome('glass', 'paper'))
    const { summary, categories } = formatDailyStats(await readDailyStats(db, 30), CATEGORY_IDS)

    expect(summary[1]).toEqual(['2026-10-15', '1', '0', '0', '0', '0', '0', '2500', '0.002500 €'])
    expect(categories[0]).toEqual(['Date', 'Model', ...CATEGORY_IDS])
    expect(categories.slice(1).map((row) => row.slice(0, 2))).toEqual([
      ['2026-10-15', 'gpt-6-luna'],
      ['2026-10-15', 'gpt-6.1-sol'],
    ])
    const glass = CATEGORY_IDS.indexOf('glass') + 2
    expect(categories[1][glass]).toBe('1')
  })
})
