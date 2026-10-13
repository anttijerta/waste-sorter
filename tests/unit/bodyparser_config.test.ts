import { describe, expect, it } from 'vitest'
import bodyParserConfig from '#config/bodyparser'

describe('bodyparser config', () => {
  it('never auto-processes multipart uploads to disk, for any route', () => {
    expect(bodyParserConfig.multipart.autoProcess).toBe(false)
  })
})
