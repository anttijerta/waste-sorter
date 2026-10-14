export type UsageLimits = {
  perIpPerMinute: number
  perIpDaily: number
  /** Integer micro-euros */
  monthlyCapMicroEur: number
}

export type CurrentUsage = {
  /** Requests from this IP hash in the last 60 seconds */
  minuteCount: number
  /** Requests from this IP hash today (UTC) */
  dayCount: number
  /** Estimated or settled spend of all users this month (UTC), micro-euros */
  monthCostMicroEur: number
  /** Budget the new request would reserve, micro-euros */
  reserveMicroEur: number
}

export type LimitReason = 'per_minute' | 'daily' | 'monthly_cap'

export type LimitDecision = { ok: true } | { ok: false; reason: LimitReason }

/**
 * Decides whether one more request fits within the limits. The monthly cap
 * is checked first: when it is hit the whole demo is paused, which is the
 * more useful message for every user.
 */
export function checkLimits(usage: CurrentUsage, limits: UsageLimits): LimitDecision {
  if (usage.monthCostMicroEur + usage.reserveMicroEur > limits.monthlyCapMicroEur) {
    return { ok: false, reason: 'monthly_cap' }
  }
  if (usage.dayCount >= limits.perIpDaily) {
    return { ok: false, reason: 'daily' }
  }
  if (usage.minuteCount >= limits.perIpPerMinute) {
    return { ok: false, reason: 'per_minute' }
  }
  return { ok: true }
}
