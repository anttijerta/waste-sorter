import { createHash } from 'node:crypto'
import { type ReasoningEffort } from '#config/models'
import { type CategoryId, categoryLabel } from '#config/categories'
import {
  type EvalRow,
  type EvalSummary,
  type Range,
  type RunsSummary,
  type Score,
  type TokenTotals,
  cacheAffectedCost,
} from '#eval/metrics'
import { type RateLimitRetry } from '#eval/eval_classifier'

export type ConfigSnapshot = {
  date: string
  classifiers: 'openai' | 'mock'
  mode: 'parallel' | 'sequential'
  runs: number
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
  summary: RunsSummary
  perRun: EvalSummary[]
  runs: EvalRow[][]
  rateLimitRetries: (RateLimitRetry & { file: string; run: number })[]
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
    config.runs > 1 ? `${config.runs}runs` : null,
    config.classifiers === 'mock' ? 'mock' : null,
  ]
    .filter(Boolean)
    .join('-')
}

export function formatEur(microEur: number): string {
  return `${(microEur / 1_000_000).toFixed(6)} €`
}

const pct = (value: number) => `${(value * 100).toFixed(1)} %`

function score(s: Score): string {
  return s.accuracy === null ? '–' : `${pct(s.accuracy)} (${s.correct}/${s.total})`
}

function rangeText(r: Range | null): string {
  if (r === null) return '–'
  return r.min === r.max ? pct(r.mean) : `${pct(r.mean)} (${pct(r.min)}–${pct(r.max)})`
}

function tokens(t: TokenTotals): string {
  return t.input.toLocaleString('en')
}

/** "glass ×2, paper ×1", most frequent first */
function answerCounts(answers: CategoryId[], expected: CategoryId, scored: boolean): string {
  const counts = new Map<CategoryId, number>()
  for (const answer of answers) counts.set(answer, (counts.get(answer) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([answer, count]) => {
      const mark = scored ? (answer === expected ? ' ✓' : ' ✗') : ''
      return `${answer}${mark} ×${count}`
    })
    .join(', ')
}

function answerCell(row: EvalRow, index: 0 | 1): string {
  const model = row.models[index]
  const mark = row.difficulty === 'oos' ? '' : model.correct ? ' ✓' : ' ✗'
  return `${model.answer}${mark}${model.error ? ` (${model.error})` : ''}`
}

function tableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`
}

/**
 * The warning shown when cache reads made a run cheaper than real usage.
 */
export function cacheWarning(summary: RunsSummary): string | null {
  if (!cacheAffectedCost(summary)) return null
  const parts = summary.models.map(
    (m) =>
      `${m.modelId}: ${m.tokens.cachedInput.toLocaleString('en')} of ${m.tokens.input.toLocaleString('en')} input tokens were cache reads; cost ${formatEur(m.totalCostMicroEur)}, without caching ${formatEur(m.costWithoutCacheMicroEur)}`
  )
  return [
    'Cached tokens lowered the cost of this run. Reruns of the same images hit the prompt cache, so these costs understate real usage with new photos.',
    ...parts,
  ].join('\n')
}

export function renderMarkdown(results: EvalResults): string {
  const { config, summary, perRun, runs } = results
  const [a, b] = summary.models
  const single = config.runs === 1
  const lines: string[] = []

  lines.push(`# Eval ${config.date}`, '')
  if (config.classifiers === 'mock') {
    lines.push('> **Mock run: models were simulated. These numbers mean nothing.**', '')
  }
  const warning = cacheWarning(summary)
  if (warning) {
    const [first, ...rest] = warning.split('\n')
    lines.push(`> **Warning:** ${first}`, ...rest.map((line) => `> - ${line}`), '')
  }

  lines.push(
    '## Configuration',
    '',
    `- Models: ${config.models.map((m) => `\`${m.id}\` (effort ${m.reasoningEffort ?? 'n/a'})`).join(', ')}`,
    `- Mode: ${config.mode}, runs: ${config.runs}`,
    `- Prompt SHA-256: \`${config.promptSha256}\``,
    `- Prices checked: ${config.pricesCheckedAt}`,
    `- openai SDK: ${config.openaiSdkVersion}`,
    `- Images: ${config.images}, calls: ${config.calls}, at most ${config.maxCallsPerMinutePerModel} calls per minute per model`,
    `- Image preparation: max ${config.image.maxSidePx} px, JPEG quality ${config.image.jpegQuality}, metadata ${config.image.metadata}`,
    `- Worst-case cost (reservation estimate): ${formatEur(config.worstCaseMicroEur)}`,
    '',
    '## Summary',
    '',
    single ? '' : `Accuracy is the mean over ${config.runs} runs, with min–max in brackets.`,
    '',
    tableRow(['', `\`${a.modelId}\``, `\`${b.modelId}\``]),
    '| --- | --- | --- |'
  )

  const both = (fn: (index: 0 | 1) => string) => [fn(0), fn(1)]
  const accuracyRow = (label: string, key: 'overall' | 'easy' | 'hard') =>
    tableRow([
      label,
      ...both((i) =>
        single
          ? score(perRun[0].models[i].accuracy[key])
          : rangeText(summary.models[i].accuracy[key])
      ),
    ])

  lines.push(
    accuracyRow('Accuracy (easy + hard)', 'overall'),
    accuracyRow('Accuracy, easy', 'easy'),
    accuracyRow('Accuracy, hard', 'hard')
  )
  if (!single) {
    lines.push(
      tableRow([
        'Same answer in every run',
        ...both(
          (i) =>
            `${summary.models[i].consistentImages}/${summary.images} images (mean ${pct(summary.models[i].meanSameShare)})`
        ),
      ])
    )
  }
  lines.push(
    tableRow(['Errors', ...both((i) => String(summary.models[i].errors))]),
    tableRow(['Rate-limit retries', ...both((i) => String(summary.models[i].rateLimitRetries))]),
    tableRow(['Input tokens', ...both((i) => tokens(summary.models[i].tokens))]),
    tableRow([
      'of which cache reads',
      ...both((i) => summary.models[i].tokens.cachedInput.toLocaleString('en')),
    ]),
    tableRow([
      'of which cache writes',
      ...both((i) => summary.models[i].tokens.cacheWrite.toLocaleString('en')),
    ]),
    tableRow([
      'Output tokens',
      ...both((i) => summary.models[i].tokens.output.toLocaleString('en')),
    ]),
    tableRow([
      'of which reasoning',
      ...both((i) => summary.models[i].tokens.reasoning.toLocaleString('en')),
    ]),
    tableRow(['Total cost', ...both((i) => formatEur(summary.models[i].totalCostMicroEur))]),
    tableRow([
      'Cost without caching',
      ...both((i) => formatEur(summary.models[i].costWithoutCacheMicroEur)),
    ]),
    tableRow([
      'Cost per 1,000 images',
      ...both((i) => formatEur(summary.models[i].costPer1000ImagesMicroEur)),
    ]),
    tableRow(['Latency, median', ...both((i) => `${summary.models[i].latencyMs.median} ms`)]),
    tableRow(['Latency, max', ...both((i) => `${summary.models[i].latencyMs.max} ms`)]),
    ''
  )
  if (a.unknownCostCalls || b.unknownCostCalls) {
    lines.push(
      `Calls without reported cost (failed before usage): ${a.unknownCostCalls} / ${b.unknownCostCalls}. Not included in the totals.`,
      ''
    )
  }

  const scored = perRun[0]?.scored ?? 0
  if (single) {
    const agreement = perRun[0].agreement
    lines.push(
      `Agreement (easy + hard, ${scored} images): ${agreement.rate === null ? '–' : pct(agreement.rate)} (${agreement.agreed}); both agreed but wrong: ${agreement.agreedButWrong}`
    )
  } else {
    const wrong = perRun.map((s) => s.agreement.agreedButWrong)
    lines.push(
      `Agreement (easy + hard, ${scored} images): ${rangeText(summary.agreementRate)}; both agreed but wrong per run: ${wrong.join(', ')}`
    )
  }
  lines.push('', '## Images', '')

  if (single) {
    lines.push(
      tableRow([
        'File',
        'Expected',
        'Difficulty',
        `\`${a.modelId}\``,
        `\`${b.modelId}\``,
        'Cost A',
        'Cost B',
        'Latency A',
        'Latency B',
      ]),
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...runs[0].map((row) =>
        tableRow([
          row.file,
          `${row.expected} (${categoryLabel(row.expected)})`,
          row.difficulty,
          answerCell(row, 0),
          answerCell(row, 1),
          row.models[0].costMicroEur === null ? '–' : formatEur(row.models[0].costMicroEur),
          row.models[1].costMicroEur === null ? '–' : formatEur(row.models[1].costMicroEur),
          `${row.models[0].latencyMs} ms`,
          `${row.models[1].latencyMs} ms`,
        ])
      )
    )
  } else {
    lines.push(
      tableRow([
        'File',
        'Expected',
        'Difficulty',
        `\`${a.modelId}\` answers`,
        `\`${b.modelId}\` answers`,
        'Same A',
        'Same B',
      ]),
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...summary.consistency.map((image) =>
        tableRow([
          image.file,
          `${image.expected} (${categoryLabel(image.expected)})`,
          image.difficulty,
          answerCounts(image.models[0].answers, image.expected, image.difficulty !== 'oos'),
          answerCounts(image.models[1].answers, image.expected, image.difficulty !== 'oos'),
          pct(image.models[0].sameShare),
          pct(image.models[1].sameShare),
        ])
      )
    )
  }

  lines.push('', '## Out of scope (not scored)', '')
  const oos = summary.consistency.filter((image) => image.difficulty === 'oos')
  if (oos.length === 0) {
    lines.push('None.')
  } else {
    const notes = new Map(runs[0].map((row) => [row.file, row.note]))
    lines.push(
      ...oos.map((image) => {
        const note = notes.get(image.file)
        return `- ${image.file}${note ? ` (${note})` : ''}: \`${a.modelId}\` ${answerCounts(image.models[0].answers, image.expected, false)}, \`${b.modelId}\` ${answerCounts(image.models[1].answers, image.expected, false)}`
      })
    )
  }
  if (results.rateLimitRetries.length > 0) {
    lines.push(
      '',
      '## Rate-limit retries',
      '',
      ...results.rateLimitRetries.map(
        (r) =>
          `- Run ${r.run}, ${r.file}, \`${r.modelId}\`: waited ${Math.round(r.waitMs / 1000)} s, retried once`
      )
    )
  }
  return lines.filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n') + '\n'
}
