import { type CategoryId } from '#config/categories'
import { type TokenUsage } from '#classifier/types'
import { type Difficulty } from '#eval/labels'

export type ModelAnswer = {
  modelId: string
  answer: CategoryId
  correct: boolean
  /** Integer micro-euros; null when a call failed without reporting usage */
  costMicroEur: number | null
  /** Duration of the API call; a rate-limit retry wait is not included */
  latencyMs: number
  error: string | null
  rateLimitRetries: number
  /** Token usage reported by the API; null when the call failed without it */
  usage: TokenUsage | null
}

export type EvalRow = {
  file: string
  expected: CategoryId
  difficulty: Difficulty
  note: string
  models: [ModelAnswer, ModelAnswer]
  /** Same logic as the app: both answered without error and match */
  agreed: boolean
}

export type Score = { total: number; correct: number; accuracy: number | null }

export type ModelSummary = {
  modelId: string
  accuracy: { overall: Score; easy: Score; hard: Score }
  errors: number
  rateLimitRetries: number
  totalCostMicroEur: number
  /** Calls whose cost is unknown (failed without usage); not in the total */
  unknownCostCalls: number
  costPer1000ImagesMicroEur: number
  latencyMs: { median: number; max: number }
}

export type EvalSummary = {
  images: number
  scored: number
  models: [ModelSummary, ModelSummary]
  /** Over scored rows (easy + hard); oos rows are excluded */
  agreement: { rate: number | null; agreed: number; agreedButWrong: number }
  oos: EvalRow[]
}

function score(rows: EvalRow[], index: 0 | 1): Score {
  const correct = rows.filter((row) => row.models[index].correct).length
  return { total: rows.length, correct, accuracy: rows.length ? correct / rows.length : null }
}

/** Median of a non-empty list; the mean of the middle two for even lengths, rounded. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function summarizeModel(rows: EvalRow[], scored: EvalRow[], index: 0 | 1): ModelSummary {
  const answers = rows.map((row) => row.models[index])
  const totalCostMicroEur = answers.reduce((sum, a) => sum + (a.costMicroEur ?? 0), 0)
  const latencies = answers.map((a) => a.latencyMs)

  return {
    modelId: answers[0]?.modelId ?? '',
    accuracy: {
      overall: score(scored, index),
      easy: score(
        scored.filter((row) => row.difficulty === 'easy'),
        index
      ),
      hard: score(
        scored.filter((row) => row.difficulty === 'hard'),
        index
      ),
    },
    errors: answers.filter((a) => a.error !== null).length,
    rateLimitRetries: answers.reduce((sum, a) => sum + a.rateLimitRetries, 0),
    totalCostMicroEur,
    unknownCostCalls: answers.filter((a) => a.costMicroEur === null).length,
    costPer1000ImagesMicroEur: rows.length
      ? Math.ceil((totalCostMicroEur / rows.length) * 1000)
      : 0,
    latencyMs: { median: median(latencies), max: latencies.length ? Math.max(...latencies) : 0 },
  }
}

/**
 * Summary over all rows. Accuracy and agreement use only easy and hard
 * rows; oos rows (outside the categories) are listed separately. Cost and
 * latency cover every call made.
 */
export function summarize(rows: EvalRow[]): EvalSummary {
  const scored = rows.filter((row) => row.difficulty !== 'oos')
  const agreed = scored.filter((row) => row.agreed)

  return {
    images: rows.length,
    scored: scored.length,
    models: [summarizeModel(rows, scored, 0), summarizeModel(rows, scored, 1)],
    agreement: {
      rate: scored.length ? agreed.length / scored.length : null,
      agreed: agreed.length,
      agreedButWrong: agreed.filter((row) => row.models[0].answer !== row.expected).length,
    },
    oos: rows.filter((row) => row.difficulty === 'oos'),
  }
}
