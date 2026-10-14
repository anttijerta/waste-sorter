import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { CATEGORY_IDS } from '#config/categories'
import { type Classifier, type ClassifierOutput } from '#classifier/types'

/**
 * Stand-in for a real model. Picks a category deterministically from the
 * image bytes. A per-model hash makes roughly one in four answers deviate,
 * so two mocks usually agree but not always. Waits a random delay to
 * imitate network latency. Makes no external calls.
 */
export class MockClassifier implements Classifier {
  readonly simulated = true

  constructor(
    readonly modelId: string,
    private options: { minDelayMs: number; maxDelayMs: number }
  ) {}

  async classify(image: Buffer): Promise<ClassifierOutput> {
    const { minDelayMs, maxDelayMs } = this.options
    await sleep(minDelayMs + Math.random() * (maxDelayMs - minDelayMs))

    const shared = createHash('sha256').update(image).digest()
    const own = createHash('sha256').update(this.modelId).update(image).digest()
    const deviates = own[0] < 64
    const category = CATEGORY_IDS[(deviates ? own[1] : shared[0]) % CATEGORY_IDS.length]

    return {
      category,
      usage: {
        inputTokens: 800 + (own[2] % 400),
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5 + (own[3] % 10),
        reasoningTokens: 0,
      },
    }
  }
}
