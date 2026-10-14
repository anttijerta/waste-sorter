import { ESTIMATED_USAGE_PER_CALL, PRICING, USD_TO_EUR } from '#config/pricing'
import { type TokenUsage } from '#classifier/types'

/**
 * Cost of one call in USD: token usage × price table.
 * Returns null when the model has no entry in the price table.
 */
export function costUsd(modelId: string, usage: TokenUsage): number | null {
  const price = PRICING[modelId]
  if (!price) {
    return null
  }
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000
  )
}

/**
 * Budget to reserve for one image before the models are called: every
 * model at the estimated upper-bound usage, in EUR. Throws when a model has
 * no price, because the monthly cap cannot be enforced without one.
 */
export function estimateImageCostEur(modelIds: readonly string[]): number {
  return modelIds.reduce((sum, modelId) => {
    const cost = costUsd(modelId, ESTIMATED_USAGE_PER_CALL)
    if (cost === null) {
      throw new Error(`No price for model "${modelId}" in config/pricing.ts`)
    }
    return sum + cost * USD_TO_EUR
  }, 0)
}
