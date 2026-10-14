import { type CategoryId } from '#config/categories'
import { costMicroEur } from '#classifier/cost'
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

export type TokenTotals = {
  input: number
  cachedInput: number
  cacheWrite: number
  output: number
  reasoning: number
}

export type ModelSummary = {
  modelId: string
  accuracy: { overall: Score; easy: Score; hard: Score }
  errors: number
  rateLimitRetries: number
  totalCostMicroEur: number
  /** Calls whose cost is unknown (failed without usage); not in the total */
  unknownCostCalls: number
  tokens: TokenTotals
  /**
   * What the same calls would cost with every input token at the normal
   * input price: no cache reads, no cache writes.
   */
  costWithoutCacheMicroEur: number
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

export function tokenTotals(answers: ModelAnswer[]): TokenTotals {
  const totals: TokenTotals = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 }
  for (const { usage } of answers) {
    if (!usage) continue
    totals.input += usage.inputTokens
    totals.cachedInput += usage.cachedInputTokens
    totals.cacheWrite += usage.cacheWriteTokens
    totals.output += usage.outputTokens
    totals.reasoning += usage.reasoningTokens
  }
  return totals
}

export function costWithoutCache(answers: ModelAnswer[]): number {
  return answers.reduce((sum, a) => {
    if (!a.usage) return sum + (a.costMicroEur ?? 0)
    const uncached = { ...a.usage, cachedInputTokens: 0, cacheWriteTokens: 0 }
    return sum + (costMicroEur(a.modelId, uncached) ?? 0)
  }, 0)
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
    tokens: tokenTotals(answers),
    costWithoutCacheMicroEur: costWithoutCache(answers),
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

export type Range = { min: number; mean: number; max: number }

export type ImageConsistency = {
  file: string
  expected: CategoryId
  difficulty: Difficulty
  /** Per model: the answer of every run, the most common one, and its share */
  models: [
    { answers: CategoryId[]; mostCommon: CategoryId; sameShare: number },
    { answers: CategoryId[]; mostCommon: CategoryId; sameShare: number },
  ]
}

export type RunsModelSummary = {
  modelId: string
  /** Accuracy across runs (null when a run had no rows of that kind) */
  accuracy: { overall: Range | null; easy: Range | null; hard: Range | null }
  /** Images where every run gave the same answer */
  consistentImages: number
  meanSameShare: number
  errors: number
  rateLimitRetries: number
  tokens: TokenTotals
  totalCostMicroEur: number
  costWithoutCacheMicroEur: number
  unknownCostCalls: number
  costPer1000ImagesMicroEur: number
  latencyMs: { median: number; max: number }
}

export type RunsSummary = {
  runs: number
  images: number
  models: [RunsModelSummary, RunsModelSummary]
  agreementRate: Range | null
  consistency: ImageConsistency[]
}

function range(values: (number | null)[]): Range | null {
  const known = values.filter((v): v is number => v !== null)
  if (known.length === 0) return null
  return {
    min: Math.min(...known),
    mean: known.reduce((sum, v) => sum + v, 0) / known.length,
    max: Math.max(...known),
  }
}

function mostCommon(answers: CategoryId[]): { answer: CategoryId; count: number } {
  const counts = new Map<CategoryId, number>()
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1)
  let best: { answer: CategoryId; count: number } = { answer: answers[0], count: 0 }
  for (const [answer, count] of counts) if (count > best.count) best = { answer, count }
  return best
}

/**
 * Combines several runs over the same images: accuracy as min, mean and
 * max across runs, how consistently each model answered each image, and
 * cost and latency over every call of every run.
 */
export function summarizeRuns(runs: EvalRow[][]): RunsSummary {
  const perRun = runs.map(summarize)
  const images = runs[0] ?? []

  const consistency: ImageConsistency[] = images.map((first, imageIndex) => {
    const model = (index: 0 | 1) => {
      const answers = runs.map((run) => run[imageIndex].models[index].answer)
      const common = mostCommon(answers)
      return { answers, mostCommon: common.answer, sameShare: common.count / answers.length }
    }
    return {
      file: first.file,
      expected: first.expected,
      difficulty: first.difficulty,
      models: [model(0), model(1)],
    }
  })

  const summarizeAcross = (index: 0 | 1): RunsModelSummary => {
    const answers = runs.flatMap((run) => run.map((row) => row.models[index]))
    const totalCostMicroEur = answers.reduce((sum, a) => sum + (a.costMicroEur ?? 0), 0)
    const latencies = answers.map((a) => a.latencyMs)
    const shares = consistency.map((image) => image.models[index].sameShare)
    return {
      modelId: answers[0]?.modelId ?? '',
      accuracy: {
        overall: range(perRun.map((s) => s.models[index].accuracy.overall.accuracy)),
        easy: range(perRun.map((s) => s.models[index].accuracy.easy.accuracy)),
        hard: range(perRun.map((s) => s.models[index].accuracy.hard.accuracy)),
      },
      consistentImages: shares.filter((share) => share === 1).length,
      meanSameShare: shares.length ? shares.reduce((sum, v) => sum + v, 0) / shares.length : 1,
      errors: answers.filter((a) => a.error !== null).length,
      rateLimitRetries: answers.reduce((sum, a) => sum + a.rateLimitRetries, 0),
      tokens: tokenTotals(answers),
      totalCostMicroEur,
      costWithoutCacheMicroEur: costWithoutCache(answers),
      unknownCostCalls: answers.filter((a) => a.costMicroEur === null).length,
      costPer1000ImagesMicroEur: answers.length
        ? Math.ceil((totalCostMicroEur / answers.length) * 1000)
        : 0,
      latencyMs: { median: median(latencies), max: latencies.length ? Math.max(...latencies) : 0 },
    }
  }

  return {
    runs: runs.length,
    images: images.length,
    models: [summarizeAcross(0), summarizeAcross(1)],
    agreementRate: range(perRun.map((s) => s.agreement.rate)),
    consistency,
  }
}

/**
 * True when cache reads made the calls cheaper than they would be for new
 * images. Reruns of the same images hit the cache; real uploads mostly
 * do not, so costs from such a run understate real usage.
 */
export function cacheAffectedCost(summary: { models: { tokens: TokenTotals }[] }): boolean {
  return summary.models.some((model) => model.tokens.cachedInput > 0)
}
