import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { VERSION as OPENAI_SDK_VERSION } from 'openai/version'
import env from '#start/env'
import ClassifyService from '#services/classify_service'
import { type PromptCacheMode } from '#classifier/openai_classifier'
import { MAX_IMAGE_BYTES } from '#controllers/classify_controller'
import { CLASSIFY_PROMPT } from '#classifier/prompt'
import { resolveReasoningEffort } from '#config/models'
import { PRICES_CHECKED_AT } from '#config/pricing'
import { EvalClassifier, MAX_CALLS_PER_MINUTE, type Clock } from '#eval/eval_classifier'
import { type Label, LabelsError, parseLabels } from '#eval/labels'
import { type EvalRow, type ModelAnswer, type Range, summarize, summarizeRuns } from '#eval/metrics'
import {
  EVAL_JPEG_QUALITY,
  EVAL_MAX_SIDE_PX,
  type SharpFactory,
  prepareImage,
} from '#eval/prepare_image'
import {
  type ConfigSnapshot,
  type EvalResults,
  cacheWarning,
  formatEur,
  renderMarkdown,
  resultsBaseName,
  sha256,
} from '#eval/report'

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => sleep(ms) }

const MAX_RUNS = 10

const PROMPT_CACHE_MODES: readonly PromptCacheMode[] = ['explicit', 'default']

function promptCacheModeText(mode: PromptCacheMode): string {
  return mode === 'explicit'
    ? 'explicit (no caching, same as the app)'
    : 'default (OpenAI default caching, NOT the app setting; cache writes can add up to 25 % to input cost)'
}

function formatRange(r: Range | null): string {
  if (!r) return '–'
  const p = (v: number) => `${(v * 100).toFixed(1)} %`
  return `mean ${p(r.mean)} (min ${p(r.min)}, max ${p(r.max)})`
}

export default class Eval extends BaseCommand {
  static commandName = 'eval'
  static description =
    'Run the labelled eval set through both models with the app classifier code. Costs money: requires --yes.'

  static options: CommandOptions = { startApp: true }

  @flags.boolean({ description: 'Actually run the eval (makes paid API calls)' })
  declare yes: boolean

  @flags.boolean({ description: 'Call the models one after the other instead of in parallel' })
  declare sequential: boolean

  @flags.string({ description: 'Eval data directory (default: EVAL_DATA_DIR)' })
  declare dataDir: string | undefined

  @flags.string({
    description: 'Images folder, relative to the data directory',
    default: 'images-jpg',
  })
  declare images: string

  @flags.number({ description: 'Run the whole set this many times (default 1)', default: 1 })
  declare runs: number

  @flags.string({
    description:
      'Prompt cache for this run: explicit (no caching, like the app) or default (OpenAI default caching)',
    default: 'explicit',
  })
  declare cacheMode: string

  async run() {
    const runs = this.runs
    if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
      this.logger.error(`--runs must be a whole number from 1 to ${MAX_RUNS}`)
      this.exitCode = 1
      return
    }

    if (!PROMPT_CACHE_MODES.includes(this.cacheMode as PromptCacheMode)) {
      this.logger.error(`--cache-mode must be one of: ${PROMPT_CACHE_MODES.join(', ')}`)
      this.exitCode = 1
      return
    }
    const promptCacheMode = this.cacheMode as PromptCacheMode

    const dataDir = this.dataDir || env.get('EVAL_DATA_DIR')
    if (!dataDir) {
      this.logger.error('Set EVAL_DATA_DIR or pass --data-dir')
      this.exitCode = 1
      return
    }
    const imagesDir = resolve(dataDir, this.images)

    // Dev-only packages, loaded here so the production image does not need them.
    // sharp (CommonJS) goes through require(): importing it as ESM trips a
    // Node 24.2 loader assertion ("Unexpected module status") in its
    // dependencies' circular requires.
    const { parse } = await import('csv-parse/sync')
    const sharp = createRequire(import.meta.url)('sharp') as SharpFactory

    let labels: Label[]
    try {
      const text = await readFile(join(dataDir, 'labels.csv'), 'utf8')
      labels = parseLabels(text, parse, (file) => {
        // Plain file names only, so a label cannot point outside the images folder.
        return basename(file) === file && existsSync(join(imagesDir, file))
      })
    } catch (error) {
      if (error instanceof LabelsError) {
        this.logger.error(error.message)
        this.exitCode = 1
        return
      }
      throw error
    }

    const setup = ClassifyService.defaultSetup({ promptCacheMode })
    const wrapped = setup.classifiers.map(
      (classifier) => new EvalClassifier(classifier, realClock)
    ) as [EvalClassifier, EvalClassifier]
    const service = new ClassifyService(wrapped)

    const configuredEffort = env.get('MODEL_REASONING_EFFORT')
    const config: ConfigSnapshot = {
      date: new Date().toISOString(),
      classifiers: setup.mode,
      mode: this.sequential ? 'sequential' : 'parallel',
      runs,
      promptCacheMode,
      models: wrapped.map((classifier) => ({
        id: classifier.modelId,
        reasoningEffort: classifier.simulated
          ? null
          : resolveReasoningEffort(classifier.modelId, configuredEffort),
      })),
      promptSha256: sha256(CLASSIFY_PROMPT),
      pricesCheckedAt: PRICES_CHECKED_AT,
      openaiSdkVersion: OPENAI_SDK_VERSION,
      image: { maxSidePx: EVAL_MAX_SIDE_PX, jpegQuality: EVAL_JPEG_QUALITY, metadata: 'stripped' },
      maxCallsPerMinutePerModel: MAX_CALLS_PER_MINUTE,
      images: labels.length,
      calls: runs * labels.length * wrapped.length,
      worstCaseMicroEur: runs * labels.length * service.reserveMicroEur,
    }

    this.logger.info(
      [
        `Classifiers: ${config.classifiers === 'openai' ? 'OpenAI (real, paid calls)' : 'MOCK (simulated)'}`,
        `Models: ${config.models.map((m) => `${m.id} (effort ${m.reasoningEffort ?? 'n/a'})`).join(', ')}`,
        `Mode: ${config.mode}, runs: ${runs}`,
        `Prompt cache: ${promptCacheModeText(promptCacheMode)}`,
        `Images: ${config.images} from ${imagesDir}`,
        `Calls: ${config.calls}, at most ${MAX_CALLS_PER_MINUTE} per minute per model`,
        `Worst-case cost (reservation estimate): ${formatEur(config.worstCaseMicroEur)}`,
      ].join('\n')
    )

    if (!this.yes) {
      this.logger.info('Nothing was run. Pass --yes to run the eval.')
      return
    }
    if (setup.mode === 'mock') {
      this.logger.warning(
        'Running with MOCK classifiers (no MODEL_API_KEY, or test environment). Results are marked mock and mean nothing.'
      )
    }

    const allRuns: EvalRow[][] = []
    const rateLimitRetries: EvalResults['rateLimitRetries'] = []

    for (let run = 1; run <= runs; run++) {
      if (runs > 1) this.logger.info(`Run ${run}/${runs}`)
      const rows: EvalRow[] = []

      for (const label of labels) {
        const original = await readFile(join(imagesDir, label.file))
        const image = await prepareImage(sharp, original, { maxBytes: MAX_IMAGE_BYTES })
        const retriesBefore = wrapped.map((classifier) => classifier.retries.length)

        const result = await service.classify(image, { sequential: this.sequential })

        const models = result.models.map((model, index): ModelAnswer => {
          const classifier = wrapped[index]
          const newRetries = classifier.retries.slice(retriesBefore[index])
          rateLimitRetries.push(...newRetries.map((retry) => ({ ...retry, file: label.file, run })))
          return {
            modelId: model.modelId,
            answer: model.category,
            correct: model.error === null && model.category === label.expected,
            costMicroEur: model.costMicroEur,
            // The throttle wait happens before the timer starts; only a
            // rate-limit retry wait is inside the timed call.
            latencyMs: Math.max(0, model.latencyMs - classifier.takeRetryWaitMs()),
            error: model.error,
            rateLimitRetries: newRetries.length,
            usage: classifier.takeLastUsage(),
          }
        }) as [ModelAnswer, ModelAnswer]

        const row: EvalRow = {
          file: label.file,
          expected: label.expected,
          difficulty: label.difficulty,
          note: label.note,
          models,
          agreed: result.agreement.agreed,
        }
        rows.push(row)
        this.logger.log(formatRow(row))
      }
      allRuns.push(rows)
    }

    const results: EvalResults = {
      config,
      summary: summarizeRuns(allRuns),
      perRun: allRuns.map(summarize),
      runs: allRuns,
      rateLimitRetries,
    }
    const resultsDir = join(dataDir, 'results')
    await mkdir(resultsDir, { recursive: true })
    const base = join(resultsDir, resultsBaseName(config))
    await writeFile(`${base}.json`, JSON.stringify(results, null, 2) + '\n')
    await writeFile(`${base}.md`, renderMarkdown(results))

    for (const [index, model] of results.summary.models.entries()) {
      const accuracy =
        runs === 1
          ? `${results.perRun[0].models[index].accuracy.overall.correct}/${results.perRun[0].models[index].accuracy.overall.total}`
          : formatRange(model.accuracy.overall)
      this.logger.info(
        `${model.modelId}: accuracy ${accuracy}, cost ${formatEur(model.totalCostMicroEur)}, median ${model.latencyMs.median} ms` +
          (runs > 1
            ? `, same answer in every run for ${model.consistentImages}/${labels.length} images`
            : '')
      )
    }
    const warning = cacheWarning(results.summary)
    if (warning) this.logger.warning(warning)
    if (rateLimitRetries.length > 0) {
      this.logger.warning(`Rate-limit retries: ${rateLimitRetries.length} (see the report)`)
    }
    this.logger.success(`Results: ${base}.json and ${base}.md`)
  }
}

function formatRow(row: EvalRow): string {
  const answer = (model: ModelAnswer) => {
    const mark = row.difficulty === 'oos' ? '·' : model.correct ? '✓' : '✗'
    const cost = model.costMicroEur === null ? '–' : `${model.costMicroEur} µ€`
    return `${model.modelId}=${model.answer} ${mark} ${cost} ${model.latencyMs} ms${model.error ? ` (${model.error})` : ''}`
  }
  return `${row.file}  expected=${row.expected} [${row.difficulty}]  ${answer(row.models[0])}  ${answer(row.models[1])}`
}
