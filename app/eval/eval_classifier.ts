import { type Classifier, type ClassifierOutput, ClassifierError } from '#classifier/types'

export const MAX_CALLS_PER_MINUTE = 20
const DEFAULT_RETRY_WAIT_MS = 30_000
const MAX_RETRY_WAIT_MS = 120_000

export type Clock = {
  now(): number
  sleep(ms: number): Promise<void>
}

export type RateLimitRetry = { modelId: string; waitMs: number }

function rateLimitWaitMs(error: unknown): number | null {
  if (!(error instanceof ClassifierError)) return null
  const cause = error.cause as { status?: unknown; headers?: { get?(name: string): string | null } }
  if (cause?.status !== 429) return null

  const headers = cause.headers
  const ms = Number(headers?.get?.('retry-after-ms'))
  const seconds = Number(headers?.get?.('retry-after'))
  const wait =
    Number.isFinite(ms) && ms > 0
      ? ms
      : Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : DEFAULT_RETRY_WAIT_MS
  return Math.min(wait, MAX_RETRY_WAIT_MS)
}

/**
 * Wraps one model's classifier for the eval (the app never uses this):
 *
 * - Throttle: call starts are at least 60 s / MAX_CALLS_PER_MINUTE apart.
 * - On a rate-limit error (HTTP 429), waits as the API asks and retries
 *   once. Retries are recorded for the report.
 *
 * Time spent waiting is accumulated so the eval can subtract it from the
 * latency measured around classify().
 */
export class EvalClassifier implements Classifier {
  readonly modelId: string
  readonly simulated: boolean
  readonly retries: RateLimitRetry[] = []
  #waitedMs = 0
  #lastStart = Number.NEGATIVE_INFINITY

  constructor(
    private inner: Classifier,
    private clock: Clock,
    private minIntervalMs = 60_000 / MAX_CALLS_PER_MINUTE
  ) {
    this.modelId = inner.modelId
    this.simulated = inner.simulated
  }

  /** Returns and resets the time waited since the last call. */
  takeWaitedMs(): number {
    const waited = this.#waitedMs
    this.#waitedMs = 0
    return waited
  }

  async classify(image: Buffer): Promise<ClassifierOutput> {
    await this.#throttle()
    try {
      return await this.inner.classify(image)
    } catch (error) {
      const waitMs = rateLimitWaitMs(error)
      if (waitMs === null) throw error
      this.retries.push({ modelId: this.modelId, waitMs })
      await this.#wait(waitMs)
      await this.#throttle()
      return this.inner.classify(image)
    }
  }

  async #throttle() {
    const waitMs = this.#lastStart + this.minIntervalMs - this.clock.now()
    if (waitMs > 0) await this.#wait(waitMs)
    this.#lastStart = this.clock.now()
  }

  async #wait(ms: number) {
    const started = this.clock.now()
    await this.clock.sleep(ms)
    this.#waitedMs += this.clock.now() - started
  }
}
