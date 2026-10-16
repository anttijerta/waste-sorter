import { createHash } from 'node:crypto'
import { CATEGORIES } from '#config/categories'

/**
 * The same instructions go to both models. Kept minimal on purpose: the
 * task and the category list, no rules for specific items.
 */
export const CLASSIFY_PROMPT = [
  'Classify the waste item in the photo into exactly one category of the',
  'Helsinki region (HSY) waste sorting guide. Answer with the category id.',
  '',
  'Categories (id: Finnish name):',
  ...CATEGORIES.map((category) => `- ${category.id}: ${category.label}`),
  '',
  'If the photo does not show a recognizable waste item, answer "unrecognized".',
].join('\n')

/**
 * Short version of the live prompt: the first 7 hex characters of its
 * SHA-256, the same hash the eval reports and config/eval_summary.ts use.
 */
export const PROMPT_VERSION = createHash('sha256').update(CLASSIFY_PROMPT).digest('hex').slice(0, 7)
