import { describe, expect, it } from 'vitest'
import { type CategoryId } from '#config/categories'
import { type Difficulty } from '#eval/labels'
import { type EvalRow, median, summarize } from '#eval/metrics'

type Answer = { answer: CategoryId; cost?: number | null; latency?: number; error?: string }

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
    { answer: 'unrecognized', error: 'failed', cost: null, latency: 9000 },
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
