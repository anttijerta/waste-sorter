import { type TokenUsage } from '#classifier/types'
import { MAX_OUTPUT_TOKENS_PER_CALL } from '#config/models'

/**
 * Prices in integer micro-USD per 1M tokens ($0.10 = 100_000), keyed by
 * model id. Standard tier, short context (≤272K input tokens; our calls
 * are far below that). Image tokens are billed as input, reasoning tokens
 * as output. Source: OpenAI pricing and model pages.
 *
 * The mock entries are fake and only used when no API key is configured.
 */
export type ModelPrice = {
  inputPerMTok: number
  cachedInputPerMTok: number
  /** Price for tokens written to the prompt cache; input price if unset */
  cacheWritePerMTok?: number
  outputPerMTok: number
}

export const PRICES_CHECKED_AT = '2026-10-14'

export const PRICING: Record<string, ModelPrice> = {
  'gpt-6-luna': { inputPerMTok: 100_000, cachedInputPerMTok: 10_000, outputPerMTok: 500_000 },
  'gpt-6.1-sol': {
    inputPerMTok: 2_000_000,
    cachedInputPerMTok: 100_000,
    cacheWritePerMTok: 2_500_000,
    outputPerMTok: 10_000_000,
  },
  'mock-a': { inputPerMTok: 250_000, cachedInputPerMTok: 250_000, outputPerMTok: 1_250_000 },
  'mock-b': { inputPerMTok: 1_000_000, cachedInputPerMTok: 1_000_000, outputPerMTok: 5_000_000 },
}

/**
 * Deliberately conservative: 1 USD is counted as 1 EUR, which overstates
 * spend while the euro is worth more than the dollar, so the cap errs safe.
 */
export const USD_TO_EUR = 1

/**
 * Upper bound of token usage for one call, used to reserve budget before
 * the call when the real usage is not known yet. Priced at the plain input
 * rate: prompt caching is disabled, so there are no cache writes.
 *
 * - Output: exactly max_output_tokens, which the API enforces and which
 *   includes reasoning tokens.
 * - Input: a measured call used 1,117 tokens for a 768×1024 image
 *   (768 patches), about 1.2 tokens per patch with the prompt and schema
 *   included. The server rejects images over 1024 px, so an image is at
 *   most 1,024 patches, about 1,450 tokens. 2,000 leaves ~38 % headroom.
 *
 * If a call ever uses more, the real cost is still recorded and a warning
 * is logged.
 */
export const ESTIMATED_USAGE_PER_CALL: TokenUsage = {
  inputTokens: 2000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: MAX_OUTPUT_TOKENS_PER_CALL,
  reasoningTokens: 0,
}
