import { describe, expect, it, vi } from 'vitest'
import OpenAI, { APIConnectionTimeoutError } from 'openai'
import { CATEGORY_IDS } from '#config/categories'
import { MAX_OUTPUT_TOKENS_PER_CALL } from '#config/models'
import { OpenAIClassifier } from '#classifier/openai_classifier'
import { ClassifierError } from '#classifier/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

const USAGE = {
  input_tokens: 1500,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens: 300,
  output_tokens_details: { reasoning_tokens: 250 },
  total_tokens: 1800,
}

/** A Responses API result with one message item per text. */
function apiResponse(texts: string[], overrides: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    incomplete_details: null,
    output: texts.map((text) => ({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    })),
    usage: USAGE,
    ...overrides,
  }
}

/** A fake client: no network, records what was sent. */
function fakeClient(result: unknown) {
  const create = vi.fn(async (_body: unknown, _options: unknown) => result)
  return { client: { responses: { create } } as unknown as Pick<OpenAI, 'responses'>, create }
}

function classifier(client: Pick<OpenAI, 'responses'>, timeoutMs = 20_000) {
  return new OpenAIClassifier('gpt-6-luna', { client, reasoningEffort: 'low', timeoutMs })
}

describe('OpenAIClassifier', () => {
  it('returns the category and the token usage, reasoning tokens included', async () => {
    const { client } = fakeClient(apiResponse(['{"category":"glass"}']))

    await expect(classifier(client).classify(IMAGE)).resolves.toEqual({
      category: 'glass',
      usage: {
        inputTokens: 1500,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 300,
        reasoningTokens: 250,
      },
    })
  })

  it('maps a category outside the list to unrecognized', async () => {
    const { client } = fakeClient(apiResponse(['{"category":"banana"}']))
    const output = await classifier(client).classify(IMAGE)
    expect(output.category).toBe('unrecognized')
  })

  it('maps output that is not JSON to unrecognized', async () => {
    const { client } = fakeClient(apiResponse(['It looks like glass.']))
    const output = await classifier(client).classify(IMAGE)
    expect(output.category).toBe('unrecognized')
  })

  it('skips an extra empty message item before the answer', async () => {
    const { client } = fakeClient(apiResponse(['', '{"category":"metal"}']))
    const output = await classifier(client).classify(IMAGE)
    expect(output.category).toBe('metal')
  })

  it('sends the image as base64 with structured output limited to the category ids', async () => {
    const { client, create } = fakeClient(apiResponse(['{"category":"paper"}']))
    await classifier(client, 12_345).classify(IMAGE)

    const [body, options] = create.mock.calls[0] as [any, any]
    expect(body.model).toBe('gpt-6-luna')
    expect(body.store).toBe(false)
    expect(body.reasoning).toEqual({ effort: 'low' })
    expect(body.max_output_tokens).toBe(MAX_OUTPUT_TOKENS_PER_CALL)

    const [text, image] = body.input[0].content
    expect(text.type).toBe('input_text')
    expect(image).toEqual({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${IMAGE.toString('base64')}`,
      detail: 'high',
    })

    expect(body.text.format.type).toBe('json_schema')
    expect(body.text.format.strict).toBe(true)
    expect(body.text.format.schema.properties.category.enum).toEqual([...CATEGORY_IDS])
    expect(options).toEqual({ timeout: 12_345, maxRetries: 0 })
  })

  it('throws with the usage when the response is incomplete, so the cost still counts', async () => {
    const { client } = fakeClient(
      apiResponse([], {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      })
    )

    const error = await classifier(client)
      .classify(IMAGE)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClassifierError)
    expect((error as ClassifierError).message).toContain('max_output_tokens')
    expect((error as ClassifierError).usage?.outputTokens).toBe(300)
  })

  it('times out without retrying, using the real SDK and no network', async () => {
    // Never answers; rejects only when the SDK aborts the request.
    const hangingFetch = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const client = new OpenAI({
      apiKey: 'not-a-real-key',
      baseURL: 'http://127.0.0.1:9/v1',
      fetch: hangingFetch as unknown as typeof fetch,
      logLevel: 'off',
    })

    const error = await classifier(client, 50)
      .classify(IMAGE)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ClassifierError)
    expect((error as ClassifierError).cause).toBeInstanceOf(APIConnectionTimeoutError)
    expect((error as ClassifierError).usage).toBeNull()
    expect(hangingFetch).toHaveBeenCalledTimes(1)
  })
})
