/**
 * Waste categories, based on the HSY sorting guide (Helsinki region).
 * Single source of truth: models must return one of these ids.
 */
export const CATEGORIES = [
  { id: 'bio', label: 'Biojäte' },
  { id: 'cardboard', label: 'Kartonki' },
  { id: 'paper', label: 'Paperi' },
  { id: 'glass', label: 'Lasi' },
  { id: 'metal', label: 'Metalli' },
  { id: 'plastic', label: 'Muovi' },
  { id: 'mixed', label: 'Sekajäte' },
  { id: 'hazardous', label: 'Vaarallinen jäte' },
  { id: 'electronics', label: 'Sähkölaitteet' },
  { id: 'textile', label: 'Tekstiili' },
  { id: 'unrecognized', label: 'Ei tunnistettu' },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id']

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((category) => category.id)

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value)
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)!.label
}
