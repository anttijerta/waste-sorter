import { describe, expect, it } from 'vitest'
import { costMicroEur, estimateCallCostMicroEur } from '#classifier/cost'
import { type TokenUsage } from '#classifier/types'

const usage = (overrides: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...overrides,
})

describe('costMicroEur', () => {
  it('prices input and output, reasoning tokens included in output', () => {
    // Luna: 1500 × $0.10/M + 300 × $0.50/M = 150 + 150 µ$
    expect(
      costMicroEur(
        'gpt-6-luna',
        usage({ inputTokens: 1500, outputTokens: 300, reasoningTokens: 250 })
      )
    ).toBe(300)
    // Sol: 1500 × $2/M + 300 × $10/M = 3000 + 3000 µ$
    expect(
      costMicroEur(
        'gpt-6.1-sol',
        usage({ inputTokens: 1500, outputTokens: 300, reasoningTokens: 250 })
      )
    ).toBe(6000)
  })

  it('bills at least the reasoning tokens even if they were reported outside output', () => {
    expect(costMicroEur('gpt-6.1-sol', usage({ outputTokens: 10, reasoningTokens: 300 }))).toBe(
      3000
    )
  })

  it('prices cached input and cache writes at their own rates', () => {
    // Sol: 500 uncached × $2/M + 1000 cached × $0.10/M + 500 written × $2.50/M
    expect(
      costMicroEur(
        'gpt-6.1-sol',
        usage({ inputTokens: 2000, cachedInputTokens: 1000, cacheWriteTokens: 500 })
      )
    ).toBe(1000 + 100 + 1250)
  })

  it('prices Luna cache writes at 1.25× its input rate', () => {
    // 1114 written × $0.125/M + 3 uncached × $0.10/M + 14 output × $0.50/M
    expect(
      costMicroEur(
        'gpt-6-luna',
        usage({ inputTokens: 1117, cacheWriteTokens: 1114, outputTokens: 14 })
      )
    ).toBe(Math.ceil(139.25 + 0.3 + 7))
  })

  it('rounds up to whole micro-euros and returns integers', () => {
    // One Luna input token costs 0.1 µ$
    expect(costMicroEur('gpt-6-luna', usage({ inputTokens: 1 }))).toBe(1)
    expect(Number.isInteger(costMicroEur('gpt-6-luna', usage({ inputTokens: 1234 })))).toBe(true)
  })

  it('returns null for a model without a price', () => {
    expect(costMicroEur('unknown-model', usage({ inputTokens: 1 }))).toBeNull()
  })
})

describe('estimateCallCostMicroEur', () => {
  it('reserves 2,000 input tokens at the cache-write rate and 800 output tokens per call', () => {
    // Luna: 2000 × $0.125/M + 800 × $0.50/M = 250 + 400 µ$
    expect(estimateCallCostMicroEur('gpt-6-luna')).toBe(650)
    // Sol: 2000 × $2.50/M + 800 × $10/M = 5000 + 8000 µ$
    expect(estimateCallCostMicroEur('gpt-6.1-sol')).toBe(13_000)
  })

  it('throws for a model without a price, because the cap needs one', () => {
    expect(() => estimateCallCostMicroEur('unknown-model')).toThrow('No price')
  })
})
