import { describe, expect, it } from 'vitest'
import { type CurrentUsage, type UsageLimits, checkLimits } from '#usage/limits'

const limits: UsageLimits = { perIpPerMinute: 5, perIpDaily: 20, monthlyCapEur: 5 }
const fresh: CurrentUsage = { minuteCount: 0, dayCount: 0, monthCostEur: 0, reserveEur: 0.01 }

describe('checkLimits', () => {
  it('allows a request under every limit', () => {
    expect(checkLimits(fresh, limits)).toEqual({ ok: true })
  })

  it('allows the last request of the minute and refuses the next one', () => {
    expect(checkLimits({ ...fresh, minuteCount: 4 }, limits)).toEqual({ ok: true })
    expect(checkLimits({ ...fresh, minuteCount: 5 }, limits)).toEqual({
      ok: false,
      reason: 'per_minute',
    })
  })

  it('allows the last request of the day and refuses the next one', () => {
    expect(checkLimits({ ...fresh, dayCount: 19 }, limits)).toEqual({ ok: true })
    expect(checkLimits({ ...fresh, dayCount: 20 }, limits)).toEqual({ ok: false, reason: 'daily' })
  })

  it('counts the reservation against the monthly cap', () => {
    expect(checkLimits({ ...fresh, monthCostEur: 4.99 }, limits)).toEqual({ ok: true })
    expect(checkLimits({ ...fresh, monthCostEur: 4.995 }, limits)).toEqual({
      ok: false,
      reason: 'monthly_cap',
    })
  })

  it('reports the monthly cap first, then the daily limit, then the per-minute limit', () => {
    const everythingHit = { minuteCount: 5, dayCount: 20, monthCostEur: 5, reserveEur: 0.01 }
    expect(checkLimits(everythingHit, limits)).toEqual({ ok: false, reason: 'monthly_cap' })
    expect(checkLimits({ ...everythingHit, monthCostEur: 0 }, limits)).toEqual({
      ok: false,
      reason: 'daily',
    })
  })
})
