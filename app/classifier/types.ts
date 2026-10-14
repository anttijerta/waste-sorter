import { type CategoryId, isCategoryId } from '#config/categories'

/**
 * Token usage of one call, as reported by the API. Reasoning tokens are
 * part of outputTokens; they are listed separately for cost checks.
 */
export type TokenUsage = {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

export type ClassifierOutput = {
  category: CategoryId
  usage: TokenUsage
}

export interface Classifier {
  readonly modelId: string
  /** True for the mock: its results are not real classifications. */
  readonly simulated: boolean
  /**
   * Optional: resolves when the classifier may start a call (the eval uses
   * it for throttling). Awaited before latency is measured, so waiting
   * never counts as call time.
   */
  waitForTurn?(): Promise<void>
  classify(image: Buffer): Promise<ClassifierOutput>
}

/**
 * A failed call. Carries the token usage when the API billed the call
 * anyway (for example an incomplete response), so its cost still counts.
 */
export class ClassifierError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage | null = null,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ClassifierError'
  }
}

/**
 * Anything that is not a known category id is treated as "unrecognized".
 */
export function normalizeCategory(raw: unknown): CategoryId {
  return isCategoryId(raw) ? raw : 'unrecognized'
}
