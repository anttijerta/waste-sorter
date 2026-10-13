import { describe, expect, it } from 'vitest'
import { compareResults } from '#classifier/agreement'

describe('compareResults', () => {
  it('agrees when both models return the same category', () => {
    expect(compareResults('glass', 'glass')).toEqual({ agreed: true, category: 'glass' })
  })

  it('disagrees when the categories differ', () => {
    expect(compareResults('paper', 'cardboard')).toEqual({ agreed: false })
  })

  it('treats two unrecognized answers as agreement on unrecognized', () => {
    expect(compareResults('unrecognized', 'unrecognized')).toEqual({
      agreed: true,
      category: 'unrecognized',
    })
  })
})
