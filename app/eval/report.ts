import { createHash } from 'node:crypto'
import { type ReasoningEffort } from '#config/models'
import { categoryLabel } from '#config/categories'
import { type EvalRow, type EvalSummary, type Score } from '#eval/metrics'
import { type RateLimitRetry } from '#eval/eval_classifier'

export type ConfigSnapshot = {
  date: string
  classifiers: 'openai' | 'mock'
  mode: 'parallel' | 'sequential'
  models: { id: string; reasoningEffort: ReasoningEffort | null }[]
  promptSha256: string
  pricesCheckedAt: string
  openaiSdkVersion: string
  image: { maxSidePx: number; jpegQuality: number; metadata: 'stripped' }
  maxCallsPerMinutePerModel: number
  images: number
  calls: number
  worstCaseMicroEur: number
}

export type EvalResults = {
  config: ConfigSnapshot
  summary: EvalSummary
  rows: EvalRow[]
  rateLimitRetries: (RateLimitRetry & { file: string })[]
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** File-name-safe UTC timestamp, e.g. 2026-10-14T16-05-03Z */
export function timestampForFile(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-')
}

export function resultsBaseName(config: ConfigSnapshot): string {
  return [
    timestampForFile(new Date(config.date)),
    config.mode === 'sequential' ? 'sequential' : null,
    config.classifiers === 'mock' ? 'mock' : null,
  ]
    .filter(Boolean)
    .join('-')
}

export function formatEur(microEur: number): string {
  return `${(microEur / 1_000_000).toFixed(6)} €`
}

function percent(s: Score): string {
  return s.accuracy === null ? '–' : `${(s.accuracy * 100).toFixed(1)} % (${s.correct}/${s.total})`
}

function answerCell(row: EvalRow, index: 0 | 1): string {
  const model = row.models[index]
  const mark = row.difficulty === 'oos' ? '' : model.correct ? ' ✓' : ' ✗'
  return `${model.answer}${mark}${model.error ? ` (${model.error})` : ''}`
}

export function renderMarkdown(results: EvalResults): string {
  const { config, summary, rows } = results
  const [a, b] = summary.models
  const lines: string[] = []

  lines.push(`# Eval ${config.date}`, '')
  if (config.classifiers === 'mock') {
    lines.push('> **Mock run: models were simulated. These numbers mean nothing.**', '')
  }
  lines.push(
    '## Configuration',
    '',
    `- Models: ${config.models.map((m) => `\`${m.id}\` (effort ${m.reasoningEffort ?? 'n/a'})`).join(', ')}`,
    `- Mode: ${config.mode}`,
    `- Prompt SHA-256: \`${config.promptSha256}\``,
    `- Prices checked: ${config.pricesCheckedAt}`,
    `- openai SDK: ${config.openaiSdkVersion}`,
    `- Images: ${config.images}, calls: ${config.calls}, at most ${config.maxCallsPerMinutePerModel} calls per minute per model`,
    `- Image preparation: max ${config.image.maxSidePx} px, JPEG quality ${config.image.jpegQuality}, metadata ${config.image.metadata}`,
    `- Worst-case cost (reservation estimate): ${formatEur(config.worstCaseMicroEur)}`,
    '',
    '## Summary',
    '',
    `| | \`${a.modelId}\` | \`${b.modelId}\` |`,
    '| --- | --- | --- |',
    `| Accuracy (easy + hard) | ${percent(a.accuracy.overall)} | ${percent(b.accuracy.overall)} |`,
    `| Accuracy, easy | ${percent(a.accuracy.easy)} | ${percent(b.accuracy.easy)} |`,
    `| Accuracy, hard | ${percent(a.accuracy.hard)} | ${percent(b.accuracy.hard)} |`,
    `| Errors | ${a.errors} | ${b.errors} |`,
    `| Rate-limit retries | ${a.rateLimitRetries} | ${b.rateLimitRetries} |`,
    `| Total cost | ${formatEur(a.totalCostMicroEur)} | ${formatEur(b.totalCostMicroEur)} |`,
    `| Cost per 1,000 images | ${formatEur(a.costPer1000ImagesMicroEur)} | ${formatEur(b.costPer1000ImagesMicroEur)} |`,
    `| Latency, median | ${a.latencyMs.median} ms | ${b.latencyMs.median} ms |`,
    `| Latency, max | ${a.latencyMs.max} ms | ${b.latencyMs.max} ms |`,
    ''
  )
  if (a.unknownCostCalls || b.unknownCostCalls) {
    lines.push(
      `Calls without reported cost (failed before usage): ${a.unknownCostCalls} / ${b.unknownCostCalls}. Not included in the totals.`,
      ''
    )
  }

  const agreementRate =
    summary.agreement.rate === null ? '–' : `${(summary.agreement.rate * 100).toFixed(1)} %`
  lines.push(
    `Agreement (easy + hard, ${summary.scored} images): ${agreementRate} (${summary.agreement.agreed}); both agreed but wrong: ${summary.agreement.agreedButWrong}`,
    '',
    '## Images',
    '',
    `| File | Expected | Difficulty | \`${a.modelId}\` | \`${b.modelId}\` | Cost A | Cost B | Latency A | Latency B |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) =>
      [
        row.file,
        `${row.expected} (${categoryLabel(row.expected)})`,
        row.difficulty,
        answerCell(row, 0),
        answerCell(row, 1),
        row.models[0].costMicroEur === null ? '–' : formatEur(row.models[0].costMicroEur),
        row.models[1].costMicroEur === null ? '–' : formatEur(row.models[1].costMicroEur),
        `${row.models[0].latencyMs} ms`,
        `${row.models[1].latencyMs} ms`,
      ]
        .map((cell) => cell.replaceAll('|', '\\|'))
        .join(' | ')
        .replace(/^/, '| ')
        .concat(' |')
    ),
    '',
    '## Out of scope (not scored)',
    ''
  )
  if (summary.oos.length === 0) {
    lines.push('None.')
  } else {
    lines.push(
      ...summary.oos.map(
        (row) =>
          `- ${row.file}${row.note ? ` (${row.note})` : ''}: \`${a.modelId}\` ${row.models[0].answer}, \`${b.modelId}\` ${row.models[1].answer}`
      )
    )
  }
  if (results.rateLimitRetries.length > 0) {
    lines.push(
      '',
      '## Rate-limit retries',
      '',
      ...results.rateLimitRetries.map(
        (r) =>
          `- ${r.file}, \`${r.modelId}\`: waited ${Math.round(r.waitMs / 1000)} s, retried once`
      )
    )
  }
  return lines.join('\n') + '\n'
}
