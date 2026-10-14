import type { Database } from '@adonisjs/lucid/database'
import { type LimitReason, type UsageLimits, checkLimits } from '#usage/limits'
import { utcDay, utcMonth } from '#usage/ip_hash'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const RETENTION_MS = 35 * 24 * HOUR_MS

export type Reservation = { ok: true; id: number } | { ok: false; reason: LimitReason }

/**
 * Per-IP and global usage accounting in SQLite.
 *
 * Budget is reserved before the models are called. The check and the
 * insert run in one transaction, and the SQLite connection pool holds a
 * single connection, so concurrent requests are serialized and cannot
 * overshoot the limits together.
 */
export default class UsageService {
  #lastCleanup = 0

  constructor(
    private db: Database,
    private limits: UsageLimits
  ) {}

  async reserve(ipHash: string, reserveMicroEur: number, now = new Date()): Promise<Reservation> {
    await this.#cleanupIfDue(now)

    const nowMs = now.getTime()
    const day = utcDay(now)
    const month = utcMonth(now)

    return this.db.transaction(async (trx) => {
      const [minute, today, spend] = await Promise.all([
        trx
          .from('usage_events')
          .where('ip_hash', ipHash)
          .where('created_at_ms', '>', nowMs - MINUTE_MS)
          .count('* as total')
          .first(),
        trx
          .from('usage_events')
          .where('ip_hash', ipHash)
          .where('day', day)
          .count('* as total')
          .first(),
        trx.from('usage_events').where('month', month).sum('cost_micro_eur as total').first(),
      ])

      const decision = checkLimits(
        {
          minuteCount: Number(minute?.total ?? 0),
          dayCount: Number(today?.total ?? 0),
          monthCostMicroEur: Number(spend?.total ?? 0),
          reserveMicroEur,
        },
        this.limits
      )
      if (!decision.ok) {
        return decision
      }

      const [id] = await trx.insertQuery().table('usage_events').insert({
        ip_hash: ipHash,
        created_at_ms: nowMs,
        day,
        month,
        cost_micro_eur: reserveMicroEur,
      })
      return { ok: true, id: Number(id) }
    })
  }

  /**
   * Replaces the reserved estimate with the settled cost. Never called with
   * zero for a failed call: the caller keeps the estimate for any model
   * whose usage is unknown, so failed calls still count.
   */
  async settle(id: number, costMicroEur: number): Promise<void> {
    await this.db.from('usage_events').where('id', id).update({ cost_micro_eur: costMicroEur })
  }

  /**
   * Deletes rows older than 35 days, at most once an hour.
   */
  async #cleanupIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.#lastCleanup < HOUR_MS) {
      return
    }
    this.#lastCleanup = now.getTime()
    await this.db
      .from('usage_events')
      .where('created_at_ms', '<', now.getTime() - RETENTION_MS)
      .delete()
  }
}
