import { ESTIMATED_USAGE_PER_CALL, PRICING, USD_TO_EUR } from '#config/pricing'
import { type TokenUsage } from '#classifier/types'

const TOKENS_PER_PRICE_UNIT = 1_000_000

/**
 * Cost of one call in integer micro-euros: token usage × price table,
 * rounded up. Returns null when the model has no entry in the price table.
 *
 * Reasoning tokens are billed as output. They are included in
 * outputTokens; billing at least reasoningTokens keeps the cost safe even
 * if they were ever reported separately.
 */
export function costMicroEur(modelId: string, usage: TokenUsage): number | null {
  const price = PRICING[modelId]
  if (!price) {
    return null
  }
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens
  )
  const output = Math.max(usage.outputTokens, usage.reasoningTokens)

  // Integer tokens × integer micro-USD per 1M tokens: exact until the division.
  const scaledMicroUsd =
    uncachedInput * price.inputPerMTok +
    usage.cachedInputTokens * price.cachedInputPerMTok +
    usage.cacheWriteTokens * (price.cacheWritePerMTok ?? price.inputPerMTok) +
    output * price.outputPerMTok

  return Math.ceil((scaledMicroUsd * USD_TO_EUR) / TOKENS_PER_PRICE_UNIT)
}

/**
 * Upper-bound cost of one call for a model, in micro-euros. Throws when
 * the model has no price, because the monthly cap cannot be enforced
 * without one.
 */
export function estimateCallCostMicroEur(modelId: string): number {
  const cost = costMicroEur(modelId, ESTIMATED_USAGE_PER_CALL)
  if (cost === null) {
    throw new Error(`No price for model "${modelId}" in config/pricing.ts`)
  }
  return cost
}
