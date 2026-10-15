import { describe, expect, it, vi } from 'vitest'
import { runModel } from '#classifier/run_model'
import { type Classifier, ClassifierError, type TokenUsage } from '#classifier/types'

const IMAGE = Buffer.from('image-bytes-that-must-never-be-logged')

const usage = (outputTokens: number): TokenUsage => ({
  inputTokens: 1500,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens,
  reasoningTokens: 0,
})

function classifierThat(classify: Classifier['classify']): Classifier {
  return { modelId: 'gpt-6.1-sol', simulated: false, classify }
}

describe('runModel', () => {
  it('returns the category and its cost in micro-euros', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const result = await runModel(
      classifierThat(async () => ({ category: 'glass', usage: usage(300) })),
      IMAGE,
      log
    )
    expect(result).toMatchObject({
      category: 'glass',
      label: 'Lasi',
      costMicroEur: 6000,
      usage: usage(300),
    })
    expect(result.error).toBeNull()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs token counts, cost and latency of every call, nothing else', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    await runModel(
      classifierThat(async () => ({ category: 'glass', usage: usage(300) })),
      IMAGE,
      log
    )
    expect(log.info).toHaveBeenCalledWith(
      {
        modelId: 'gpt-6.1-sol',
        inputTokens: 1500,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 300,
        reasoningTokens: 0,
        costMicroEur: 6000,
        estimateMicroEur: 13_000,
        latencyMs: expect.any(Number),
      },
      'model call usage'
    )
  })

  it('keeps the real cost of a failed call that was billed', async () => {
    const result = await runModel(
      classifierThat(async () => {
        throw new ClassifierError('Model response not completed: max_output_tokens', usage(2000))
      }),
      IMAGE,
      { info: vi.fn(), warn: vi.fn() }
    )
    expect(result).toMatchObject({ category: 'unrecognized', costMicroEur: 23_000 })
    expect(result.error).toBe('Mallin kutsu epäonnistui')
  })

  it('reports no cost for a failed call without usage, so the reservation stays', async () => {
    const result = await runModel(
      classifierThat(async () => {
        throw new ClassifierError('Model call failed', null, { cause: new Error('timeout') })
      }),
      IMAGE,
      { info: vi.fn(), warn: vi.fn() }
    )
    expect(result.costMicroEur).toBeNull()
  })

  it('logs only the model, error name and status, never the image or the message', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const cause = Object.assign(new Error('secret request details'), { status: 500 })
    await runModel(
      classifierThat(async () => {
        throw new ClassifierError('Model call failed', null, { cause })
      }),
      IMAGE,
      log
    )
    expect(log.warn).toHaveBeenCalledWith(
      { modelId: 'gpt-6.1-sol', error: 'Error', status: 500 },
      'model call failed'
    )
    const logged = JSON.stringify(log.warn.mock.calls)
    expect(logged).not.toContain('secret request details')
    expect(logged).not.toContain(IMAGE.toString())
    expect(logged).not.toContain(IMAGE.toString('base64'))
  })

  it('warns when a call costs more than the reserved estimate', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    await runModel(
      classifierThat(async () => ({ category: 'glass', usage: usage(5000) })),
      IMAGE,
      log
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'gpt-6.1-sol', outputTokens: 5000 }),
      'model call cost more than the reserved estimate'
    )
  })
})
