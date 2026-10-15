import type { Database } from '@adonisjs/lucid/database'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { type CategoryId } from '#config/categories'
import { type LimitReason } from '#usage/limits'

/**
 * What one classified image adds to the daily statistics. Null when the
 * request failed as a whole: it still counts as an image and one error.
 */
export type ClassificationOutcome = {
  agreed: boolean
  models: { modelId: string; category: CategoryId; failed: boolean }[]
}

export type DailyStatsRow = {
  day: string
  images: number
  agreements: number
  errors: number
  rejectedPerMinute: number
  rejectedDaily: number
  rejectedMonthlyCap: number
  costMicroEur: number
  /** model id -> category -> count */
  categories: Record<string, Partial<Record<CategoryId, number>>>
}

const REJECTION_COLUMNS: Record<LimitReason, string> = {
  per_minute: 'rejected_per_minute',
  daily: 'rejected_daily',
  monthly_cap: 'rejected_monthly_cap',
}

/**
 * Adds to the day's counters, creating the row on first use. Runs inside
 * the caller's transaction.
 */
async function addToDay(
  trx: TransactionClientContract,
  day: string,
  increments: Partial<Record<string, number>>
): Promise<void> {
  const columns = Object.entries(increments).filter(([, value]) => value)
  if (columns.length === 0) return
  await trx
    .insertQuery()
    .table('daily_stats')
    .knexQuery.insert({ day, ...Object.fromEntries(columns) })
    .onConflict('day')
    .merge(
      Object.fromEntries(
        columns.map(([column, value]) => [
          column,
          trx.knexRawQuery(`daily_stats.${column} + ?`, [value!]),
        ])
      )
    )
}

export async function recordRejection(
  trx: TransactionClientContract,
  day: string,
  reason: LimitReason
): Promise<void> {
  await addToDay(trx, day, { [REJECTION_COLUMNS[reason]]: 1 })
}

export async function recordClassification(
  trx: TransactionClientContract,
  day: string,
  costMicroEur: number,
  outcome: ClassificationOutcome | null
): Promise<void> {
  await addToDay(trx, day, {
    images: 1,
    agreements: outcome?.agreed ? 1 : 0,
    errors: outcome ? outcome.models.filter((model) => model.failed).length : 1,
    cost_micro_eur: costMicroEur,
  })
  for (const model of outcome?.models ?? []) {
    await trx
      .insertQuery()
      .table('daily_category_counts')
      .knexQuery.insert({ day, model_id: model.modelId, category: model.category, count: 1 })
      .onConflict(['day', 'model_id', 'category'])
      .merge({ count: trx.knexRawQuery('daily_category_counts.count + 1') })
  }
}

/**
 * The most recent days, newest first, with category counts per model.
 */
export async function readDailyStats(db: Database, days: number): Promise<DailyStatsRow[]> {
  const rows = await db.from('daily_stats').orderBy('day', 'desc').limit(days)
  if (rows.length === 0) return []

  const counts = await db
    .from('daily_category_counts')
    .whereIn(
      'day',
      rows.map((row) => row.day)
    )
    .orderBy(['model_id', 'category'])

  return rows.map((row) => {
    const categories: DailyStatsRow['categories'] = {}
    for (const count of counts.filter((c) => c.day === row.day)) {
      categories[count.model_id] ??= {}
      categories[count.model_id][count.category as CategoryId] = Number(count.count)
    }
    return {
      day: row.day,
      images: Number(row.images),
      agreements: Number(row.agreements),
      errors: Number(row.errors),
      rejectedPerMinute: Number(row.rejected_per_minute),
      rejectedDaily: Number(row.rejected_daily),
      rejectedMonthlyCap: Number(row.rejected_monthly_cap),
      costMicroEur: Number(row.cost_micro_eur),
      categories,
    }
  })
}

function euros(microEur: number): string {
  return `${(microEur / 1_000_000).toFixed(6)} €`
}

/**
 * Tables for `node ace stats`: one row per day, and one row per day and
 * model with a column per category.
 */
export function formatDailyStats(
  rows: DailyStatsRow[],
  categoryIds: readonly CategoryId[]
): { summary: string[][]; categories: string[][] } {
  const summary = [
    [
      'Date',
      'Images',
      'Agreements',
      'Errors',
      'Rejected/min',
      'Rejected/day',
      'Rejected/month cap',
      'Cost (µ€)',
      'Cost',
    ],
    ...rows.map((row) => [
      row.day,
      String(row.images),
      String(row.agreements),
      String(row.errors),
      String(row.rejectedPerMinute),
      String(row.rejectedDaily),
      String(row.rejectedMonthlyCap),
      String(row.costMicroEur),
      euros(row.costMicroEur),
    ]),
  ]

  const categories = [
    ['Date', 'Model', ...categoryIds],
    ...rows.flatMap((row) =>
      Object.entries(row.categories).map(([modelId, counts]) => [
        row.day,
        modelId,
        ...categoryIds.map((id) => String(counts[id] ?? 0)),
      ])
    ),
  ]
  return { summary, categories }
}
