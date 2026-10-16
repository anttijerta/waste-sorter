import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLASSIFY_PROMPT, PROMPT_VERSION } from '#classifier/prompt'
import { EVAL_SUMMARY } from '#config/eval_summary'

const sets = { testSet: EVAL_SUMMARY.testSet, holdout: EVAL_SUMMARY.holdout }

describe('EVAL_SUMMARY', () => {
  it('was measured with the current prompt', () => {
    // If this fails, the prompt changed: rerun the eval and update
    // config/eval_summary.ts, so the page does not show stale numbers.
    const current = createHash('sha256').update(CLASSIFY_PROMPT).digest('hex')
    expect(EVAL_SUMMARY.promptSha256).toBe(current)
  })

  it.each(Object.entries(sets))('%s lists the models the app uses', (_name, set) => {
    expect(set.models.map((model) => model.modelId)).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
    for (const model of set.models) {
      expect(model.accuracy).toBeGreaterThan(0)
      expect(model.accuracy).toBeLessThanOrEqual(1)
    }
  })

  it.each(Object.entries(sets))('%s has a date and a sample size', (_name, set) => {
    expect(set.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isInteger(set.images) && set.images > 0).toBe(true)
    expect(Number.isInteger(set.runs) && set.runs > 0).toBe(true)
  })
})

describe('PROMPT_VERSION', () => {
  it('is the start of the hash the eval results were measured with', () => {
    expect(PROMPT_VERSION).toMatch(/^[0-9a-f]{7}$/)
    expect(EVAL_SUMMARY.promptSha256.startsWith(PROMPT_VERSION)).toBe(true)
  })
})
