import { describe, it, expect } from 'vitest'
import { maskMomoPhone } from './phone-mask'

const BLANK = '••••••••'

describe('maskMomoPhone', () => {
  it.each([
    ['0241234567', '024••••567'],
    ['+233241234567', '024••••567'],
    ['233241234567', '024••••567'],
    ['024 123 4567', '024••••567'],
    ['024-123-4567', '024••••567'],
    ['+233 24 123 4567', '024••••567'],
  ])('masks %s', (raw, out) => expect(maskMomoPhone(raw)).toBe(out))

  it.each([['024123456'], ['02412345678'], ['2332412345'], ['abc'], [''], ['1241234567']])(
    'invalid %j -> blank, never echoing input',
    (raw) => {
      const out = maskMomoPhone(raw)
      expect(out).toBe(BLANK)
      if (raw) expect(out).not.toContain(raw)
    },
  )
})
