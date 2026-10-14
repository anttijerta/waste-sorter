import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { runModel } from '#classifier/run_model'
import { type Classifier } from '#classifier/types'
import { EvalClassifier } from '#eval/eval_classifier'

const CALL_MS = 40
const INTERVAL_MS = 300

/** A model that takes CALL_MS per call, on real timers. */
function slowModel(modelId: string): Classifier {
  return {
    modelId,
    simulated: false,
    classify: async () => {
      await sleep(CALL_MS)
      return {
        category: 'glass',
        usage: {
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
        },
      }
    },
  }
}

describe('eval latency in parallel mode', () => {
  it('reports and logs the call duration, without the throttle wait', async () => {
    const realClock = { now: () => Date.now(), sleep: (ms: number) => sleep(ms) }
    const models = ['gpt-6-luna', 'gpt-6.1-sol'].map(
      (id) => new EvalClassifier(slowModel(id), realClock, INTERVAL_MS)
    )
    const log = { info: vi.fn(), warn: vi.fn() }

    // Two images back to back, both models in parallel like the app. The
    // second image has to wait for the throttle, as in a real eval run.
    const latencies: number[] = []
    for (let image = 0; image < 2; image++) {
      const started = Date.now()
      const results = await Promise.all(models.map((m) => runModel(m, Buffer.alloc(1), log)))
      const elapsed = Date.now() - started
      if (image === 1) expect(elapsed).toBeGreaterThanOrEqual(INTERVAL_MS - CALL_MS - 20)
      latencies.push(...results.map((r) => r.latencyMs))
    }

    const logged = log.info.mock.calls.map(([details]) => details.latencyMs)
    expect(logged).toEqual(latencies)
    for (const latency of latencies) {
      expect(latency).toBeGreaterThanOrEqual(CALL_MS - 5)
      expect(latency).toBeLessThan(INTERVAL_MS / 2)
    }
  })
})
