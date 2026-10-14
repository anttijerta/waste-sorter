import type OpenAI from 'openai'
import type { Response, ResponseUsage } from 'openai/resources/responses/responses'
import { CATEGORY_IDS, type CategoryId } from '#config/categories'
import { IMAGE_DETAIL, MAX_OUTPUT_TOKENS_PER_CALL, type ReasoningEffort } from '#config/models'
import { CLASSIFY_PROMPT } from '#classifier/prompt'
import {
  type Classifier,
  type ClassifierOutput,
  ClassifierError,
  type TokenUsage,
  normalizeCategory,
} from '#classifier/types'

export type OpenAIClassifierOptions = {
  client: Pick<OpenAI, 'responses'>
  reasoningEffort: ReasoningEffort
  timeoutMs: number
}

const CATEGORY_SCHEMA = {
  type: 'object',
  properties: { category: { type: 'string', enum: [...CATEGORY_IDS] } },
  required: ['category'],
  additionalProperties: false,
}

function toUsage(usage: ResponseUsage | null | undefined): TokenUsage | null {
  if (!usage) {
    return null
  }
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
  }
}

/**
 * Takes the first output text that parses as `{ category }`. Looking at
 * every message item tolerates an occasional extra, empty message item.
 * Anything that is not a known category id becomes "unrecognized".
 */
function parseCategory(response: Response): CategoryId {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content) {
      if (part.type !== 'output_text') continue
      try {
        const parsed: unknown = JSON.parse(part.text)
        if (parsed && typeof parsed === 'object' && 'category' in parsed) {
          return normalizeCategory(parsed.category)
        }
      } catch {
        // Not JSON; try the next part.
      }
    }
  }
  return 'unrecognized'
}

/**
 * Classifies an image with an OpenAI model through the Responses API, with
 * structured output restricted to the category ids.
 *
 * Privacy: the response is not stored at OpenAI (store: false), and
 * nothing here logs the image, the request or the API key.
 */
export class OpenAIClassifier implements Classifier {
  readonly simulated = false

  constructor(
    readonly modelId: string,
    private options: OpenAIClassifierOptions
  ) {}

  async classify(image: Buffer): Promise<ClassifierOutput> {
    let response: Response
    try {
      response = await this.options.client.responses.create(
        {
          model: this.modelId,
          store: false,
          reasoning: { effort: this.options.reasoningEffort },
          max_output_tokens: MAX_OUTPUT_TOKENS_PER_CALL,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: CLASSIFY_PROMPT },
                {
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${image.toString('base64')}`,
                  detail: IMAGE_DETAIL,
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'waste_category',
              strict: true,
              schema: CATEGORY_SCHEMA,
            },
          },
        },
        // No automatic retries: a retry would double the cost of one image.
        { timeout: this.options.timeoutMs, maxRetries: 0 }
      )
    } catch (error) {
      throw new ClassifierError('Model call failed', null, { cause: error })
    }

    const usage = toUsage(response.usage)
    if (response.status !== 'completed') {
      const reason = response.incomplete_details?.reason ?? response.status ?? 'unknown'
      throw new ClassifierError(`Model response not completed: ${reason}`, usage)
    }
    if (!usage) {
      throw new ClassifierError('Model response has no usage')
    }
    return { category: parseCategory(response), usage }
  }
}
