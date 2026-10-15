import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLASSIFY_PROMPT } from '#classifier/prompt'
import { EVAL_SUMMARY } from '#config/eval_summary'

describe('EVAL_SUMMARY', () => {
  it('was measured with the current prompt', () => {
    // If this fails, the prompt changed: rerun the eval and update
    // config/eval_summary.ts, so the page does not show stale numbers.
    const current = createHash('sha256').update(CLASSIFY_PROMPT).digest('hex')
    expect(EVAL_SUMMARY.promptSha256).toBe(current)
  })

  it('lists the models the app uses', () => {
    expect(EVAL_SUMMARY.models.map((model) => model.modelId)).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
    for (const model of EVAL_SUMMARY.models) {
      expect(model.accuracy).toBeGreaterThan(0)
      expect(model.accuracy).toBeLessThanOrEqual(1)
    }
  })
})
