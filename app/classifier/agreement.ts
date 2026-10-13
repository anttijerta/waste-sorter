import { type CategoryId } from '#config/categories'

export type Agreement = { agreed: true; category: CategoryId } | { agreed: false }

export function compareResults(a: CategoryId, b: CategoryId): Agreement {
  return a === b ? { agreed: true, category: a } : { agreed: false }
}
