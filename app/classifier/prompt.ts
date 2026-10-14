import { CATEGORIES } from '#config/categories'

/**
 * The same instructions go to both models. Kept minimal on purpose: the
 * task and the category list, no rules for specific items.
 */
export const CLASSIFY_PROMPT = [
  'Classify the waste item in the photo into exactly one category of the',
  'Helsinki region (HSY) waste sorting guide. Answer with the category id.',
  'Sort items according to the waste sorting rules of the Helsinki region (HSY).',
  '',
  'Categories (id: Finnish name):',
  ...CATEGORIES.map((category) => `- ${category.id}: ${category.label}`),
  '',
  'If the photo does not show a recognizable waste item, answer "unrecognized".',
].join('\n')
