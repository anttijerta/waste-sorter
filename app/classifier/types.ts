import { type CategoryId, isCategoryId } from '#config/categories'

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
}

export type ClassifierOutput = {
  category: CategoryId
  usage: TokenUsage
}

export interface Classifier {
  readonly modelId: string
  /** True for the mock: its results are not real classifications. */
  readonly simulated: boolean
  classify(image: Buffer): Promise<ClassifierOutput>
}

/**
 * Anything that is not a known category id is treated as "unrecognized".
 */
export function normalizeCategory(raw: unknown): CategoryId {
  return isCategoryId(raw) ? raw : 'unrecognized'
}
