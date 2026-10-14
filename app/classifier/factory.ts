import type OpenAI from 'openai'
import { resolveReasoningEffort } from '#config/models'
import { MockClassifier } from '#classifier/mock_classifier'
import { OpenAIClassifier } from '#classifier/openai_classifier'
import { type Classifier } from '#classifier/types'

export const DEFAULT_MODEL_A = 'gpt-6-luna'
export const DEFAULT_MODEL_B = 'gpt-6.1-sol'

export type ClassifierSettings = {
  apiKey: string | undefined
  /** In tests the real API is never called, whatever the configuration */
  inTest: boolean
  modelA: string | undefined
  modelB: string | undefined
  reasoningEffort: string | undefined
  timeoutMs: number
  mockDelay: { minDelayMs: number; maxDelayMs: number }
  createClient: (apiKey: string, timeoutMs: number) => Pick<OpenAI, 'responses'>
}

export type ClassifierSetup = {
  classifiers: [Classifier, Classifier]
  mode: 'openai' | 'mock'
}

/**
 * Real OpenAI models when an API key is configured, otherwise mocks (demo
 * mode). The mocks use their own ids and fake prices, so real model names
 * never appear next to simulated results.
 *
 * The reasoning effort is validated for the configured models in both
 * modes, so a bad configuration fails at startup either way.
 */
export function createClassifiers(settings: ClassifierSettings): ClassifierSetup {
  const modelA = settings.modelA || DEFAULT_MODEL_A
  const modelB = settings.modelB || DEFAULT_MODEL_B
  const effortA = resolveReasoningEffort(modelA, settings.reasoningEffort)
  const effortB = resolveReasoningEffort(modelB, settings.reasoningEffort)

  if (!settings.apiKey || settings.inTest) {
    return {
      mode: 'mock',
      classifiers: [
        new MockClassifier('mock-a', settings.mockDelay),
        new MockClassifier('mock-b', settings.mockDelay),
      ],
    }
  }

  const client = settings.createClient(settings.apiKey, settings.timeoutMs)
  return {
    mode: 'openai',
    classifiers: [
      new OpenAIClassifier(modelA, {
        client,
        reasoningEffort: effortA,
        timeoutMs: settings.timeoutMs,
      }),
      new OpenAIClassifier(modelB, {
        client,
        reasoningEffort: effortB,
        timeoutMs: settings.timeoutMs,
      }),
    ],
  }
}
