import type OpenAI from 'openai'
import { resolveReasoningEffort } from '#config/models'
import { MockClassifier } from '#classifier/mock_classifier'
import { OpenAIClassifier } from '#classifier/openai_classifier'
import { type Classifier } from '#classifier/types'
import { type PromptCacheMode } from '#classifier/openai_classifier'

export const DEFAULT_MODEL_A = 'gpt-6-luna'
export const DEFAULT_MODEL_B = 'gpt-6.1-sol'

export type ClassifierSettings = {
  apiKey: string | undefined
  /** In tests the real API is never called, whatever the configuration */
  inTest: boolean
  /** Production refuses to run without a key unless mocks are allowed */
  inProduction: boolean
  /** ALLOW_MOCK_MODELS: demo mode in production, on purpose */
  allowMockModels: boolean
  modelA: string | undefined
  modelB: string | undefined
  reasoningEffort: string | undefined
  timeoutMs: number
  /** Eval only; the app leaves this unset, which means APP_PROMPT_CACHE_MODE */
  promptCacheMode?: PromptCacheMode
  mockDelay: { minDelayMs: number; maxDelayMs: number }
  createClient: (apiKey: string, timeoutMs: number) => Pick<OpenAI, 'responses'>
}

export type ClassifierSetup = {
  classifiers: [Classifier, Classifier]
  mode: 'openai' | 'mock'
}

export const MISSING_API_KEY_MESSAGE =
  'MODEL_API_KEY is not set. In production the app needs it to call the real models; ' +
  'set ALLOW_MOCK_MODELS=true to run with simulated models (demo mode) instead.'

/**
 * Real OpenAI models when an API key is configured, otherwise mocks (demo
 * mode). The mocks use their own ids and fake prices, so real model names
 * never appear next to simulated results.
 *
 * In production a missing key is an error unless ALLOW_MOCK_MODELS is set,
 * so a deployment cannot fall back to simulated results by accident. Tests
 * always use the mocks.
 *
 * The reasoning effort is validated for the configured models in both
 * modes, so a bad configuration fails at startup either way.
 */
export function createClassifiers(settings: ClassifierSettings): ClassifierSetup {
  const modelA = settings.modelA || DEFAULT_MODEL_A
  const modelB = settings.modelB || DEFAULT_MODEL_B
  const effortA = resolveReasoningEffort(modelA, settings.reasoningEffort)
  const effortB = resolveReasoningEffort(modelB, settings.reasoningEffort)

  if (!settings.apiKey && !settings.inTest && settings.inProduction && !settings.allowMockModels) {
    throw new Error(MISSING_API_KEY_MESSAGE)
  }

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
        promptCacheMode: settings.promptCacheMode,
      }),
      new OpenAIClassifier(modelB, {
        client,
        reasoningEffort: effortB,
        timeoutMs: settings.timeoutMs,
        promptCacheMode: settings.promptCacheMode,
      }),
    ],
  }
}
