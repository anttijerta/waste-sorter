import { type TokenUsage } from '#classifier/types'

/**
 * Price per million tokens, in USD, keyed by model id.
 *
 * The mock entries are fake and only exist so the skeleton can show cost
 * figures before real model calls are wired in.
 */
export type ModelPrice = {
  inputPerMTok: number
  outputPerMTok: number
}

export const PRICES_CHECKED_AT = '2026-10-13'

export const PRICING: Record<string, ModelPrice> = {
  'mock-a': { inputPerMTok: 0.25, outputPerMTok: 1.25 },
  'mock-b': { inputPerMTok: 1, outputPerMTok: 5 },
}

/**
 * Deliberately conservative: 1 USD is counted as 1 EUR, which overstates
 * spend while the euro is worth more than the dollar, so the cap errs safe.
 */
export const USD_TO_EUR = 1

/**
 * Upper bound of token usage for one call with a 1024 px image. Used to
 * reserve budget before the call, when the real usage is not known yet.
 */
export const ESTIMATED_USAGE_PER_CALL: TokenUsage = { inputTokens: 2000, outputTokens: 100 }
