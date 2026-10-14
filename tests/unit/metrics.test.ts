import { describe, expect, it } from 'vitest'
import { type CategoryId } from '#config/categories'
import { type Difficulty } from '#eval/labels'
import { type TokenUsage } from '#classifier/types'
import { type EvalRow, cacheAffectedCost, median, summarize, summarizeRuns } from '#eval/metrics'

type Answer = {
  answer: CategoryId
  cost?: number | null
  latency?: number
  error?: string
  usage?: TokenUsage | null
}

const USAGE: TokenUsage = {
  inputTokens: 1000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 20,
  reasoningTokens: 5,
}

function row(
  file: string,
  expected: CategoryId,
  difficulty: Difficulty,
  a: Answer,
  b: Answer
): EvalRow {
  const model = (modelId: string, m: Answer) => ({
    modelId,
    answer: m.answer,
    correct: !m.error && m.answer === expected,
    costMicroEur: m.cost === undefined ? 100 : m.cost,
    latencyMs: m.latency ?? 1000,
    error: m.error ?? null,
    rateLimitRetries: 0,
    usage: m.usage === undefined ? USAGE : m.usage,
  })
  return {
    file,
    expected,
    difficulty,
    note: '',
    models: [model('A', a), model('B', b)],
    agreed: !a.error && !b.error && a.answer === b.answer,
  }
}

const rows: EvalRow[] = [
  row('1', 'glass', 'easy', { answer: 'glass', latency: 1000 }, { answer: 'glass', latency: 4000 }),
  row(
    '2',
    'paper',
    'easy',
    { answer: 'paper', latency: 2000 },
    { answer: 'cardboard', latency: 5000 }
  ),
  // Both agree, both wrong
  row('3', 'mixed', 'hard', { answer: 'glass', latency: 3000 }, { answer: 'glass', latency: 6000 }),
  // A failed: counts as wrong, no agreement, cost unknown
  row(
    '4',
    'metal',
    'hard',
    { answer: 'unrecognized', error: 'failed', cost: null, latency: 9000, usage: null },
    { answer: 'metal', latency: 7000 }
  ),
  // Out of scope: excluded from accuracy and agreement, but costs count
  row(
    '5',
    'unrecognized',
    'oos',
    { answer: 'plastic', latency: 500 },
    { answer: 'plastic', cost: 200, latency: 100 }
  ),
]

describe('summarize', () => {
  const summary = summarize(rows)
  const [a, b] = summary.models

  it('scores easy and hard rows, overall and separately', () => {
    expect(summary.images).toBe(5)
    expect(summary.scored).toBe(4)
    expect(a.accuracy.overall).toEqual({ total: 4, correct: 2, accuracy: 0.5 })
    expect(a.accuracy.easy).toEqual({ total: 2, correct: 2, accuracy: 1 })
    expect(a.accuracy.hard).toEqual({ total: 2, correct: 0, accuracy: 0 })
    expect(b.accuracy.overall).toEqual({ total: 4, correct: 2, accuracy: 0.5 })
    expect(b.accuracy.hard).toEqual({ total: 2, correct: 1, accuracy: 0.5 })
  })

  it('counts a failed call as wrong and as an error', () => {
    expect(a.errors).toBe(1)
    expect(b.errors).toBe(0)
  })

  it('lists oos rows separately and keeps them out of accuracy and agreement', () => {
    expect(summary.oos.map((r) => r.file)).toEqual(['5'])
    // Row 5 agrees but is oos, so only rows 1 and 3 count as agreement
    expect(summary.agreement).toEqual({ rate: 0.5, agreed: 2, agreedButWrong: 1 })
  })

  it('totals costs over every call and scales to 1,000 images', () => {
    // A: 4 known calls × 100; the failed call's cost is unknown
    expect(a.totalCostMicroEur).toBe(400)
    expect(a.unknownCostCalls).toBe(1)
    expect(a.costPer1000ImagesMicroEur).toBe(80_000)
    // B: 4 × 100 + 200
    expect(b.totalCostMicroEur).toBe(600)
    expect(b.costPer1000ImagesMicroEur).toBe(120_000)
  })

  it('reports median and max latency per model', () => {
    expect(a.latencyMs).toEqual({ median: 2000, max: 9000 })
    expect(b.latencyMs).toEqual({ median: 5000, max: 7000 })
  })

  it('handles an empty run', () => {
    const empty = summarize([])
    expect(empty.agreement.rate).toBeNull()
    expect(empty.models[0].accuracy.overall.accuracy).toBeNull()
  })
})

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(3)
    expect(median([])).toBe(0)
  })
})

/** One scored row where model B is gpt-6.1-sol with the given usage. */
function solRow(usage: TokenUsage): EvalRow {
  const r = row('x', 'glass', 'easy', { answer: 'glass' }, { answer: 'glass', usage, cost: 0 })
  return { ...r, models: [r.models[0], { ...r.models[1], modelId: 'gpt-6.1-sol' }] }
}

describe('cache effects', () => {
  it('totals tokens per model, including cache reads, cache writes and reasoning', () => {
    // A: 4 calls with usage (the failed one has none)
    expect(summarize(rows).models[0].tokens).toEqual({
      input: 4000,
      cachedInput: 0,
      cacheWrite: 0,
      output: 80,
      reasoning: 20,
    })
  })

  it('prices the same calls without caching, and flags runs where cache reads lowered the cost', () => {
    const withReads = summarize([solRow({ ...USAGE, cachedInputTokens: 900 })])
    // Without caching: 1000 input × $2/M + 20 output × $10/M = 2000 + 200 µ€
    expect(withReads.models[1].costWithoutCacheMicroEur).toBe(2200)
    expect(withReads.models[1].tokens.cachedInput).toBe(900)
    expect(cacheAffectedCost(withReads)).toBe(true)
  })

  it('does not warn for cache writes, which make calls dearer, not cheaper', () => {
    const withWrites = summarize([solRow({ ...USAGE, cacheWriteTokens: 1000 })])
    expect(withWrites.models[1].tokens.cacheWrite).toBe(1000)
    expect(cacheAffectedCost(withWrites)).toBe(false)
  })
})

describe('summarizeRuns', () => {
  // Three runs over the same two scored images and one oos image
  const run = (a1: CategoryId, b1: CategoryId, a2: CategoryId): EvalRow[] => [
    row('1', 'glass', 'easy', { answer: a1 }, { answer: b1 }),
    row('2', 'paper', 'hard', { answer: a2 }, { answer: 'paper' }),
    row('3', 'unrecognized', 'oos', { answer: 'plastic' }, { answer: 'plastic' }),
  ]
  const summary = summarizeRuns([
    run('glass', 'glass', 'paper'),
    run('glass', 'metal', 'cardboard'),
    run('glass', 'glass', 'paper'),
  ])
  const [a, b] = summary.models

  it('reports accuracy as min, mean and max across runs', () => {
    expect(summary.runs).toBe(3)
    expect(a.accuracy.overall).toEqual({ min: 0.5, mean: 5 / 6, max: 1 })
    expect(a.accuracy.easy).toEqual({ min: 1, mean: 1, max: 1 })
    expect(a.accuracy.hard).toEqual({ min: 0, mean: 2 / 3, max: 1 })
    expect(b.accuracy.overall).toEqual({ min: 0.5, mean: 5 / 6, max: 1 })
  })

  it('reports how often each model gave the same answer per image', () => {
    const [image1, image2, oos] = summary.consistency
    expect(image1.models[0]).toEqual({
      answers: ['glass', 'glass', 'glass'],
      mostCommon: 'glass',
      sameShare: 1,
    })
    expect(image1.models[1]).toEqual({
      answers: ['glass', 'metal', 'glass'],
      mostCommon: 'glass',
      sameShare: 2 / 3,
    })
    expect(image2.models[0].sameShare).toBe(2 / 3)
    expect(oos.difficulty).toBe('oos')
    // A: images 1 and 3 always the same; B: images 2 and 3
    expect(a.consistentImages).toBe(2)
    expect(b.consistentImages).toBe(2)
    expect(a.meanSameShare).toBeCloseTo((1 + 2 / 3 + 1) / 3)
  })

  it('totals cost over every call of every run, and agreement per run', () => {
    // 3 runs × 3 images × 100 µ€
    expect(a.totalCostMicroEur).toBe(900)
    expect(a.costPer1000ImagesMicroEur).toBe(100_000)
    // Scored agreement per run: 2/2 (glass, paper), 0/2, 2/2
    expect(summary.agreementRate).toEqual({ min: 0, mean: 2 / 3, max: 1 })
  })
})
