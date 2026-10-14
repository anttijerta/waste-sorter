import { describe, expect, it } from 'vitest'
import { type TokenUsage } from '#classifier/types'
import { type EvalRow, summarize, summarizeRuns } from '#eval/metrics'
import { type ConfigSnapshot, cacheWarning, renderMarkdown, resultsBaseName } from '#eval/report'

const usage = (cachedInputTokens: number): TokenUsage => ({
  inputTokens: 1000,
  cachedInputTokens,
  cacheWriteTokens: 0,
  outputTokens: 20,
  reasoningTokens: 0,
})

function evalRow(cached: number): EvalRow {
  const model = (modelId: string) => ({
    modelId,
    answer: 'glass' as const,
    correct: true,
    costMicroEur: 150,
    latencyMs: 1200,
    error: null,
    rateLimitRetries: 0,
    usage: usage(cached),
  })
  return {
    file: 'IMG_1.jpg',
    expected: 'glass',
    difficulty: 'easy',
    note: '',
    models: [model('gpt-6-luna'), model('gpt-6.1-sol')],
    agreed: true,
  }
}

function config(runs: number): ConfigSnapshot {
  return {
    date: '2026-10-14T16:05:03.123Z',
    classifiers: 'openai',
    mode: 'parallel',
    runs,
    promptCacheMode: 'explicit',
    models: [
      { id: 'gpt-6-luna', reasoningEffort: 'low' },
      { id: 'gpt-6.1-sol', reasoningEffort: 'low' },
    ],
    promptSha256: 'abc',
    pricesCheckedAt: '2026-10-14',
    openaiSdkVersion: '7.25.0',
    image: { maxSidePx: 1024, jpegQuality: 0.85, metadata: 'stripped' },
    maxCallsPerMinutePerModel: 20,
    images: 1,
    calls: 2 * runs,
    worstCaseMicroEur: 29_400 * runs,
  }
}

function results(runs: EvalRow[][]) {
  return {
    config: config(runs.length),
    summary: summarizeRuns(runs),
    perRun: runs.map(summarize),
    runs,
    rateLimitRetries: [],
  }
}

describe('eval report', () => {
  it('warns when cached tokens lowered the cost, with the uncached cost', () => {
    const markdown = renderMarkdown(results([[evalRow(900)]]))
    expect(markdown).toContain('**Warning:** Cached tokens lowered the cost of this run')
    expect(markdown).toContain('900 of 1,000 input tokens were cache reads')
    expect(markdown).toContain('| of which cache reads | 900 | 900 |')
    expect(cacheWarning(summarizeRuns([[evalRow(900)]]))).toContain('without caching')
  })

  it('has no cache warning when nothing was read from the cache', () => {
    const markdown = renderMarkdown(results([[evalRow(0)]]))
    expect(markdown).not.toContain('Warning')
    expect(cacheWarning(summarizeRuns([[evalRow(0)]]))).toBeNull()
  })

  it('shows per-image answers for one run and consistency for several', () => {
    const one = renderMarkdown(results([[evalRow(0)]]))
    expect(one).toContain('| IMG_1.jpg | glass (Lasi) | easy | glass ✓ | glass ✓ |')
    expect(one).not.toContain('Same answer in every run')

    const three = renderMarkdown(results([[evalRow(0)], [evalRow(0)], [evalRow(0)]]))
    expect(three).toContain('runs: 3')
    expect(three).toContain('| Same answer in every run | 1/1 images (mean 100.0 %) |')
    expect(three).toContain(
      '| IMG_1.jpg | glass (Lasi) | easy | glass ✓ ×3 | glass ✓ ×3 | 100.0 % | 100.0 % |'
    )
  })

  it('names files by timestamp, mode, runs, cache mode and mock', () => {
    expect(resultsBaseName(config(1))).toBe('2026-10-14T16-05-03Z')
    expect(
      resultsBaseName({
        ...config(3),
        mode: 'sequential',
        classifiers: 'mock',
        promptCacheMode: 'default',
      })
    ).toBe('2026-10-14T16-05-03Z-sequential-3runs-cache-default-mock')
  })

  it('shows the prompt cache mode in the configuration snapshot', () => {
    const explicit = renderMarkdown(results([[evalRow(0)]]))
    expect(explicit).toContain('- Prompt cache: explicit (no caching, same as the app)')

    const withDefault = renderMarkdown({
      ...results([[evalRow(0)]]),
      config: { ...config(1), promptCacheMode: 'default' },
    })
    expect(withDefault).toContain(
      '- Prompt cache: default (OpenAI default caching, not the app setting)'
    )
  })
})
