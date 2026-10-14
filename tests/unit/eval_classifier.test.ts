import { describe, expect, it, vi } from 'vitest'
import { type Classifier, ClassifierError } from '#classifier/types'
import { type Clock, EvalClassifier } from '#eval/eval_classifier'

const OUTPUT = {
  category: 'glass' as const,
  usage: {
    inputTokens: 1,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
  },
}

/** A clock that only moves when the code sleeps, so tests run instantly. */
function fakeClock(): Clock & { sleeps: number[] } {
  let now = 0
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
    },
  }
}

function rateLimitError(headers: Record<string, string> = {}) {
  const cause = Object.assign(new Error('Rate limit'), {
    status: 429,
    headers: new Headers(headers),
  })
  return new ClassifierError('Model call failed', null, { cause })
}

function inner(
  classify: Classifier['classify']
): Classifier & { classify: ReturnType<typeof vi.fn> } {
  return { modelId: 'gpt-6-luna', simulated: false, classify: vi.fn(classify) }
}

describe('EvalClassifier', () => {
  it('keeps call starts at least 3 s apart (20 per minute)', async () => {
    const clock = fakeClock()
    const model = inner(async () => OUTPUT)
    const throttled = new EvalClassifier(model, clock)

    await throttled.classify(Buffer.alloc(1))
    await throttled.classify(Buffer.alloc(1))
    await throttled.classify(Buffer.alloc(1))

    expect(model.classify).toHaveBeenCalledTimes(3)
    expect(clock.sleeps).toEqual([3000, 3000])
    expect(throttled.takeWaitedMs()).toBe(6000)
    expect(throttled.takeWaitedMs()).toBe(0)
  })

  it('does not wait when calls are already far enough apart', async () => {
    const clock = fakeClock()
    const throttled = new EvalClassifier(
      inner(async () => OUTPUT),
      clock
    )
    await throttled.classify(Buffer.alloc(1))
    await clock.sleep(10_000)
    clock.sleeps.length = 0
    await throttled.classify(Buffer.alloc(1))
    expect(clock.sleeps).toEqual([])
  })

  it('retries once after a rate-limit error, waiting as the API asks, and records it', async () => {
    const clock = fakeClock()
    let calls = 0
    const model = inner(async () => {
      calls++
      if (calls === 1) throw rateLimitError({ 'retry-after': '7' })
      return OUTPUT
    })
    const throttled = new EvalClassifier(model, clock)

    await expect(throttled.classify(Buffer.alloc(1))).resolves.toEqual(OUTPUT)
    expect(model.classify).toHaveBeenCalledTimes(2)
    expect(clock.sleeps).toEqual([7000])
    expect(throttled.retries).toEqual([{ modelId: 'gpt-6-luna', waitMs: 7000 }])
    expect(throttled.takeWaitedMs()).toBe(7000)
  })

  it('prefers retry-after-ms, defaults to 30 s and never waits over 120 s', async () => {
    for (const [headers, expected] of [
      [{ 'retry-after-ms': '1500', 'retry-after': '9' }, 1500],
      [{}, 30_000],
      [{ 'retry-after': '600' }, 120_000],
    ] as const) {
      const clock = fakeClock()
      let first = true
      const throttled = new EvalClassifier(
        inner(async () => {
          if (first) {
            first = false
            throw rateLimitError(headers)
          }
          return OUTPUT
        }),
        clock
      )
      await throttled.classify(Buffer.alloc(1))
      expect(clock.sleeps[0]).toBe(expected)
    }
  })

  it('gives up after one retry', async () => {
    const model = inner(async () => {
      throw rateLimitError()
    })
    const throttled = new EvalClassifier(model, fakeClock())
    await expect(throttled.classify(Buffer.alloc(1))).rejects.toBeInstanceOf(ClassifierError)
    expect(model.classify).toHaveBeenCalledTimes(2)
  })

  it('does not retry other errors', async () => {
    const timeout = new ClassifierError('Model call failed', null, {
      cause: Object.assign(new Error('timeout'), { status: undefined }),
    })
    const model = inner(async () => {
      throw timeout
    })
    const throttled = new EvalClassifier(model, fakeClock())
    await expect(throttled.classify(Buffer.alloc(1))).rejects.toBe(timeout)
    expect(model.classify).toHaveBeenCalledTimes(1)
    expect(throttled.retries).toEqual([])
  })
})
