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
