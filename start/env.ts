/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Models
  MODEL_A: Env.schema.string.optional(),
  MODEL_B: Env.schema.string.optional(),
  MODEL_API_KEY: Env.schema.secret.optional(),
  ALLOW_MOCK_MODELS: Env.schema.boolean.optional(),
  MODEL_REASONING_EFFORT: Env.schema.string.optional(),
  MODEL_TIMEOUT_MS: Env.schema.number.optional(),

  // Database
  DB_PATH: Env.schema.string.optional(),

  // Eval: labels.csv, images and results, outside this repo
  EVAL_DATA_DIR: Env.schema.string.optional(),

  // Usage caps
  RATE_LIMIT_PER_IP_PER_MINUTE: Env.schema.number.optional(),
  RATE_LIMIT_PER_IP_DAILY: Env.schema.number.optional(),
  GLOBAL_MONTHLY_CAP_EUR: Env.schema.number.optional(),
  TRUSTED_PROXIES: Env.schema.string.optional(),
})
