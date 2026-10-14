import { performance } from 'node:perf_hooks'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { costUsd, estimateImageCostEur } from '#classifier/cost'
import { ESTIMATED_USAGE_PER_CALL, USD_TO_EUR } from '#config/pricing'
import { type Agreement, compareResults } from '#classifier/agreement'
import { MockClassifier } from '#classifier/mock_classifier'
import { type Classifier } from '#classifier/types'
import { type CategoryId, categoryLabel } from '#config/categories'

export type ModelResult = {
  modelId: string
  category: CategoryId
  label: string
  latencyMs: number
  costUsd: number | null
  error: string | null
}

export type ClassifyResponse = {
  models: [ModelResult, ModelResult]
  agreement: { agreed: true; category: CategoryId; label: string } | { agreed: false }
}

/**
 * A failing model must not fail the whole request: it is reported as
 * "unrecognized" with an error message, and the other result still shows.
 */
async function runOne(classifier: Classifier, image: Buffer): Promise<ModelResult> {
  const started = performance.now()
  try {
    const output = await classifier.classify(image)
    return {
      modelId: classifier.modelId,
      category: output.category,
      label: categoryLabel(output.category),
      latencyMs: Math.round(performance.now() - started),
      costUsd: costUsd(classifier.modelId, output.usage),
      error: null,
    }
  } catch {
    return {
      modelId: classifier.modelId,
      category: 'unrecognized',
      label: categoryLabel('unrecognized'),
      latencyMs: Math.round(performance.now() - started),
      costUsd: null,
      error: 'Mallin kutsu epäonnistui',
    }
  }
}

export default class ClassifyService {
  /**
   * Budget reserved per image before the models are called. Computing it
   * here makes the app fail at startup when a model has no price.
   */
  readonly reserveEur: number

  constructor(
    private classifiers: [Classifier, Classifier] = ClassifyService.defaultClassifiers()
  ) {
    this.reserveEur = estimateImageCostEur(classifiers.map((classifier) => classifier.modelId))
  }

  /**
   * Settled cost of one image in EUR. A model without a known cost (failed
   * call) keeps its reserved estimate, so failed calls still count.
   */
  settledCostEur(result: ClassifyResponse | undefined): number {
    if (!result) {
      return this.reserveEur
    }
    return result.models.reduce((sum, model) => {
      const usd = model.costUsd ?? costUsd(model.modelId, ESTIMATED_USAGE_PER_CALL)!
      return sum + usd * USD_TO_EUR
    }, 0)
  }

  /**
   * Demo mode is on while any model is simulated, so the UI can say so.
   */
  get demoMode(): boolean {
    return this.classifiers.some((classifier) => classifier.simulated)
  }

  static defaultClassifiers(): [Classifier, Classifier] {
    const delay = app.inTest
      ? { minDelayMs: 0, maxDelayMs: 50 }
      : { minDelayMs: 200, maxDelayMs: 900 }
    return [
      new MockClassifier(env.get('MODEL_A', 'mock-a'), delay),
      new MockClassifier(env.get('MODEL_B', 'mock-b'), delay),
    ]
  }

  /**
   * Runs both models in parallel on the same image.
   */
  async classify(image: Buffer): Promise<ClassifyResponse> {
    const [a, b] = await Promise.all([
      runOne(this.classifiers[0], image),
      runOne(this.classifiers[1], image),
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
