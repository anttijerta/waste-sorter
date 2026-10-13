import { PRICING } from '#config/pricing'
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
