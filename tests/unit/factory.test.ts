import { describe, expect, it, vi } from 'vitest'
import { type ClassifierSettings, createClassifiers } from '#classifier/factory'
import { MockClassifier } from '#classifier/mock_classifier'
import { OpenAIClassifier } from '#classifier/openai_classifier'

/** createClient is a spy, so no test can construct a real OpenAI client. */
function settings(overrides: Partial<ClassifierSettings> = {}) {
  const createClient = vi.fn(() => ({ responses: {} }) as any)
  const value: ClassifierSettings = {
    apiKey: undefined,
    inTest: false,
    modelA: 'gpt-6-luna',
    modelB: 'gpt-6.1-sol',
    reasoningEffort: undefined,
    timeoutMs: 20_000,
    mockDelay: { minDelayMs: 0, maxDelayMs: 0 },
    createClient,
    ...overrides,
  }
  return { value, createClient }
}

describe('createClassifiers', () => {
  it('falls back to the mock classifiers when MODEL_API_KEY is missing or empty', () => {
    for (const apiKey of [undefined, '']) {
      const { value, createClient } = settings({ apiKey })
      const setup = createClassifiers(value)

      expect(setup.mode).toBe('mock')
      expect(setup.classifiers.map((c) => c.modelId)).toEqual(['mock-a', 'mock-b'])
      expect(setup.classifiers.every((c) => c instanceof MockClassifier && c.simulated)).toBe(true)
      expect(createClient).not.toHaveBeenCalled()
    }
  })

  it('never uses the real API in the test environment, even with a key', () => {
    const { value, createClient } = settings({ apiKey: 'not-a-real-key', inTest: true })
    expect(createClassifiers(value).mode).toBe('mock')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('uses both OpenAI models with one shared client when a key is set', () => {
    const { value, createClient } = settings({ apiKey: 'not-a-real-key', timeoutMs: 15_000 })
    const setup = createClassifiers(value)

    expect(setup.mode).toBe('openai')
    expect(setup.classifiers.map((c) => c.modelId)).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
    expect(setup.classifiers.every((c) => c instanceof OpenAIClassifier && !c.simulated)).toBe(true)
    expect(createClient).toHaveBeenCalledExactlyOnceWith('not-a-real-key', 15_000)
  })

  it("uses OpenAI's default prompt caching unless the eval overrides it", async () => {
    const create = vi.fn(async () => ({
      status: 'completed',
      output: [],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }))
    const createClient = () => ({ responses: { create } }) as any

    for (const [promptCacheMode, expected] of [
      [undefined, undefined],
      ['default', undefined],
      ['explicit', { mode: 'explicit' }],
    ] as const) {
      create.mockClear()
      const setup = createClassifiers({
        ...settings({ apiKey: 'not-a-real-key', promptCacheMode }).value,
        createClient,
      })
      await setup.classifiers[1].classify(Buffer.from([0xff, 0xd8]))
      const body = (create.mock.calls[0] as any[])[0]
      expect(body.prompt_cache_options).toEqual(expected)
    }
  })

  it('fails at startup when a model does not support the configured effort, in either mode', () => {
    expect(() => createClassifiers(settings({ reasoningEffort: 'none' }).value)).toThrow(
      /gpt-6.1-sol.*does not support/
    )
    expect(() =>
      createClassifiers(settings({ apiKey: 'not-a-real-key', reasoningEffort: 'none' }).value)
    ).toThrow(/does not support/)
  })
})
