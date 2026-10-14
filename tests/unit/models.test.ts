import { describe, expect, it } from 'vitest'
import { resolveReasoningEffort } from '#config/models'

describe('resolveReasoningEffort', () => {
  it('defaults to low for both models, so they run under the same settings', () => {
    expect(resolveReasoningEffort('gpt-6-luna', undefined)).toBe('low')
    expect(resolveReasoningEffort('gpt-6.1-sol', '')).toBe('low')
  })

  it('uses the configured value when the model supports it', () => {
    expect(resolveReasoningEffort('gpt-6.1-sol', 'medium')).toBe('medium')
  })

  it('rejects a value the model does not support', () => {
    expect(resolveReasoningEffort('gpt-6-luna', 'none')).toBe('none')
    expect(() => resolveReasoningEffort('gpt-6.1-sol', 'none')).toThrow(/does not support/)
    expect(() => resolveReasoningEffort('gpt-6.1-sol', 'fast')).toThrow(/does not support/)
  })

  it('rejects an unknown model', () => {
    expect(() => resolveReasoningEffort('gpt-unknown', undefined)).toThrow(/Unknown model/)
  })
})
