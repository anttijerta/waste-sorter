import OpenAI from 'openai'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { estimateCallCostMicroEur } from '#classifier/cost'
import { type Agreement, compareResults } from '#classifier/agreement'
import { type ClassifierSetup, createClassifiers } from '#classifier/factory'
import { type PromptCacheMode } from '#classifier/openai_classifier'
import { type ModelResult, runModel } from '#classifier/run_model'
import { type Classifier } from '#classifier/types'
import { type CategoryId, categoryLabel } from '#config/categories'
import { CLASSIFY_PROMPT } from '#classifier/prompt'
import { MAX_OUTPUT_TOKENS_PER_CALL } from '#config/models'

export type { ModelResult }

export type ClassifyResponse = {
  models: [ModelResult, ModelResult]
  agreement: { agreed: true; category: CategoryId; label: string } | { agreed: false }
}

/** What the server did with the upload before the models saw it. */
export type PreparedImage = {
  width: number
  height: number
  bytes: number
  /** Bytes of EXIF, XMP and other metadata removed on the server */
  metadataBytesRemoved: number
}

/** The /api/classify response: the results plus the image the models got. */
export type ClassifyApiResponse = ClassifyResponse & { image: PreparedImage }

/** What every call sends besides the image, for the "what happened" view. */
export type RequestSettings = {
  prompt: string
  maxOutputTokens: number
  models: { modelId: string; reasoningEffort: string | null }[]
}

export default class ClassifyService {
  /**
   * Budget reserved per image before the models are called, in integer
   * micro-euros. Computing it here makes the app fail at startup when a
   * model has no price.
   */
  readonly reserveMicroEur: number

  constructor(
    private classifiers: [Classifier, Classifier] = ClassifyService.defaultSetup().classifiers
  ) {
    this.reserveMicroEur = classifiers.reduce(
      (sum, classifier) => sum + estimateCallCostMicroEur(classifier.modelId),
      0
    )
  }

  /**
   * Settled cost of one image in micro-euros. A model without a known cost
   * (failed without usage) keeps its reserved estimate, so failed calls
   * still count.
   */
  settledCostMicroEur(result: ClassifyResponse | undefined): number {
    if (!result) {
      return this.reserveMicroEur
    }
    return result.models.reduce(
      (sum, model) => sum + (model.costMicroEur ?? estimateCallCostMicroEur(model.modelId)),
      0
    )
  }

  /**
   * The prompt and per-model settings sent with every image. The same for
   * both models apart from the model id.
   */
  get requestSettings(): RequestSettings {
    return {
      prompt: CLASSIFY_PROMPT,
      maxOutputTokens: MAX_OUTPUT_TOKENS_PER_CALL,
      models: this.classifiers.map((classifier) => ({
        modelId: classifier.modelId,
        reasoningEffort: classifier.reasoningEffort ?? null,
      })),
    }
  }

  /**
   * Demo mode is on while any model is simulated, so the UI can say so.
   */
  get demoMode(): boolean {
    return this.classifiers.some((classifier) => classifier.simulated)
  }

  /**
   * The app's classifiers from env. The eval may override the prompt cache
   * mode for comparison runs; the app never does.
   */
  static defaultSetup(overrides: { promptCacheMode?: PromptCacheMode } = {}): ClassifierSetup {
    const setup = createClassifiers({
      apiKey: env.get('MODEL_API_KEY')?.release(),
      inTest: app.inTest,
      inProduction: app.inProduction,
      allowMockModels: env.get('ALLOW_MOCK_MODELS', false),
      modelA: env.get('MODEL_A'),
      modelB: env.get('MODEL_B'),
      reasoningEffort: env.get('MODEL_REASONING_EFFORT'),
      timeoutMs: env.get('MODEL_TIMEOUT_MS', 20_000),
      promptCacheMode: overrides.promptCacheMode,
      mockDelay: app.inTest
        ? { minDelayMs: 0, maxDelayMs: 50 }
        : { minDelayMs: 200, maxDelayMs: 900 },
      // No automatic retries, and the SDK never logs requests.
      createClient: (apiKey, timeoutMs) =>
        new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, logLevel: 'off' }),
    })
    logger.info(
      { mode: setup.mode, models: setup.classifiers.map((classifier) => classifier.modelId) },
      setup.mode === 'mock'
        ? 'mock classifier active (no MODEL_API_KEY, or test environment)'
        : 'OpenAI classifiers active'
    )
    return setup
  }

  /**
   * Runs both models on the same image: in parallel (the app), or one
   * after the other when the eval compares latency between the modes.
   */
  async classify(
    image: Buffer,
    { sequential = false }: { sequential?: boolean } = {}
  ): Promise<ClassifyResponse> {
    const [a, b] = sequential
      ? [
          await runModel(this.classifiers[0], image, logger),
          await runModel(this.classifiers[1], image, logger),
        ]
      : await Promise.all([
          runModel(this.classifiers[0], image, logger),
          runModel(this.classifiers[1], image, logger),
        ])
    const agreement: Agreement =
      a.error || b.error ? { agreed: false } : compareResults(a.category, b.category)

    return {
      models: [a, b],
      agreement: agreement.agreed
        ? { ...agreement, label: categoryLabel(agreement.category) }
        : agreement,
    }
  }
}
