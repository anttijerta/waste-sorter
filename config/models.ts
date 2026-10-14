/**
 * Model settings for the OpenAI classifiers. Checked against the OpenAI
 * model pages on 2026-10-14.
 */

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const SUPPORTED_REASONING_EFFORTS: Record<string, readonly ReasoningEffort[]> = {
  'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
}

/**
 * Same effort for both models, so the demo compares them under the same
 * settings. "low" is the lowest value both models support.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'

/**
 * Sent as max_output_tokens, which caps reasoning and visible output
 * together. The API enforces it, so it is also the output bound used when
 * reserving budget (see config/pricing.ts).
 */
export const MAX_OUTPUT_TOKENS_PER_CALL = 2000

/**
 * "high" caps an image at 2,500 patches. The server only accepts images up
 * to 1024 px, which is at most 1,024 patches.
 */
export const IMAGE_DETAIL = 'high' as const

/**
 * The effort to use for a model: MODEL_REASONING_EFFORT if set, otherwise
 * the shared default. Throws for unknown models and unsupported values, so
 * a bad configuration stops the app at startup.
 */
export function resolveReasoningEffort(
  modelId: string,
  configured: string | undefined
): ReasoningEffort {
  const supported = SUPPORTED_REASONING_EFFORTS[modelId]
  if (!supported) {
    throw new Error(`Unknown model "${modelId}": add its reasoning efforts to config/models.ts`)
  }
  const effort = (configured || DEFAULT_REASONING_EFFORT) as ReasoningEffort
  if (!supported.includes(effort)) {
    throw new Error(
      `Model "${modelId}" does not support reasoning effort "${effort}" (supported: ${supported.join(', ')})`
    )
  }
  return effort
}
