import { CATEGORIES } from '#config/categories'

/**
 * The same instructions go to both models: the task, a short list of HSY
 * sorting rules, and the category list.
 */
export const CLASSIFY_PROMPT = [
  'Classify the waste item in the photo into exactly one category of the',
  'Helsinki region (HSY) waste sorting guide. Answer with the category id.',
  '',
  'Rules of the Helsinki region (HSY):',
  '- Sort packaging by the material it is mainly made of.',
  '- Paper packaging, such as paper bags, wrappers, gift wrap and paper pouches (also with an aluminium lining), goes to cardboard. Paper is only for printed paper such as newspapers, magazines, ads and letters.',
  '- Receipts are thermal paper and go to mixed waste.',
  '- Glass collection is only for glass jars and bottles. Drinking glasses, ceramics and porcelain go to mixed waste.',
  '- Empty plastic packaging goes to plastic, also when it looks metallic.',
  '- Batteries go to hazardous waste.',
  '',
  'Categories (id: Finnish name):',
  ...CATEGORIES.map((category) => `- ${category.id}: ${category.label}`),
  '',
  'If the photo does not show a recognizable waste item, answer "unrecognized".',
].join('\n')
