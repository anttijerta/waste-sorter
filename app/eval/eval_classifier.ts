import {
  type Classifier,
  type ClassifierOutput,
  ClassifierError,
  type TokenUsage,
} from '#classifier/types'

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
 *   This happens in waitForTurn(), before runModel starts its timer, so
 *   the measured and logged latency is the call alone.
 * - On a rate-limit error (HTTP 429), waits as the API asks and retries
 *   once. That wait happens inside the timed call; it is recorded so the
 *   eval can report the call duration without it.
 * - Keeps the token usage of the last call, for cache reporting.
 */
export class EvalClassifier implements Classifier {
  readonly modelId: string
  readonly simulated: boolean
  readonly retries: RateLimitRetry[] = []
  #retryWaitMs = 0
  #lastUsage: TokenUsage | null = null
  #lastStart = Number.NEGATIVE_INFINITY

  constructor(
    private inner: Classifier,
    private clock: Clock,
    private minIntervalMs = 60_000 / MAX_CALLS_PER_MINUTE
  ) {
    this.modelId = inner.modelId
    this.simulated = inner.simulated
  }

  /** Returns and resets the rate-limit retry wait inside the last call. */
  takeRetryWaitMs(): number {
    const waited = this.#retryWaitMs
    this.#retryWaitMs = 0
    return waited
  }

  /** Returns and resets the usage of the last call (null if unknown). */
  takeLastUsage(): TokenUsage | null {
    const usage = this.#lastUsage
    this.#lastUsage = null
    return usage
  }

  async waitForTurn(): Promise<void> {
    const waitMs = this.#lastStart + this.minIntervalMs - this.clock.now()
    if (waitMs > 0) await this.clock.sleep(waitMs)
    this.#lastStart = this.clock.now()
  }

  async classify(image: Buffer): Promise<ClassifierOutput> {
    try {
      return this.#record(await this.inner.classify(image))
    } catch (error) {
      const waitMs = rateLimitWaitMs(error)
      if (waitMs === null) throw this.#recordError(error)
      this.retries.push({ modelId: this.modelId, waitMs })

      const started = this.clock.now()
      await this.clock.sleep(waitMs)
      await this.waitForTurn()
      this.#retryWaitMs += this.clock.now() - started

      try {
        return this.#record(await this.inner.classify(image))
      } catch (retryError) {
        throw this.#recordError(retryError)
      }
    }
  }

  #record(output: ClassifierOutput): ClassifierOutput {
    this.#lastUsage = output.usage
    return output
  }

  #recordError(error: unknown): unknown {
    this.#lastUsage = error instanceof ClassifierError ? error.usage : null
    return error
  }
}
