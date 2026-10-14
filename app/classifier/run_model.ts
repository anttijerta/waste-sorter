import { performance } from 'node:perf_hooks'
import { type CategoryId, categoryLabel } from '#config/categories'
import { costMicroEur, estimateCallCostMicroEur } from '#classifier/cost'
import { type Classifier, ClassifierError, type TokenUsage } from '#classifier/types'

export type ModelResult = {
  modelId: string
  category: CategoryId
  label: string
  latencyMs: number
  /** Integer micro-euros; null when the call failed without usage */
  costMicroEur: number | null
  error: string | null
}

/**
 * Minimal logger interface, so this module does not depend on the app.
 * Only model ids, error names, statuses and token counts are logged:
 * never the image, the request or the API key.
 */
export type ModelLogger = {
  warn(details: Record<string, unknown>, message: string): void
}

const FAILED_MESSAGE = 'Mallin kutsu epäonnistui'

function checkAgainstEstimate(
  modelId: string,
  usage: TokenUsage,
  cost: number | null,
  log: ModelLogger
) {
  if (cost !== null && cost > estimateCallCostMicroEur(modelId)) {
    log.warn(
      {
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
      },
      'model call cost more than the reserved estimate'
    )
  }
}

/**
 * Runs one model. A failing model must not fail the whole request: it is
 * reported as "unrecognized" with an error message, and the other result
 * still shows. A failed call that was billed keeps its real cost.
 */
export async function runModel(
  classifier: Classifier,
  image: Buffer,
  log: ModelLogger
): Promise<ModelResult> {
  const started = performance.now()
  try {
    const output = await classifier.classify(image)
    const cost = costMicroEur(classifier.modelId, output.usage)
    checkAgainstEstimate(classifier.modelId, output.usage, cost, log)
    return {
      modelId: classifier.modelId,
      category: output.category,
      label: categoryLabel(output.category),
      latencyMs: Math.round(performance.now() - started),
      costMicroEur: cost,
      error: null,
    }
  } catch (error) {
    const usage = error instanceof ClassifierError ? error.usage : null
    const cause = error instanceof Error ? (error.cause ?? error) : error
    log.warn(
      {
        modelId: classifier.modelId,
        error: cause instanceof Error ? cause.name : typeof cause,
        status: (cause as { status?: unknown } | undefined)?.status,
      },
      'model call failed'
    )
    const cost = usage ? costMicroEur(classifier.modelId, usage) : null
    if (usage) checkAgainstEstimate(classifier.modelId, usage, cost, log)
    return {
      modelId: classifier.modelId,
      category: 'unrecognized',
      label: categoryLabel('unrecognized'),
      latencyMs: Math.round(performance.now() - started),
      costMicroEur: cost,
      error: FAILED_MESSAGE,
    }
  }
}
