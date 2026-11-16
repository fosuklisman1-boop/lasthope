import { describe, it, expect } from 'vitest'
import { normalizeGhanaPhone, toLocalPhone } from './phone'

describe('normalizeGhanaPhone', () => {
  it.each([
    ['0241234567', '+233241234567'],
    ['+233241234567', '+233241234567'],
    ['233241234567', '+233241234567'],
    ['024 123 4567', '+233241234567'],
    ['024-123-4567', '+233241234567'],
  ])('%s', (i, o) => expect(normalizeGhanaPhone(i)).toBe(o))
  it.each(['', '12345', '02412345', 'abc', '0241234567890'])('invalid %s -> null', (i) => expect(normalizeGhanaPhone(i)).toBeNull())
})

describe('toLocalPhone', () => {
  it.each([
    ['0241234567', '0241234567'],
    ['+233241234567', '0241234567'],
    ['233241234567', '0241234567'],
    ['024 123-4567', '0241234567'],
  ])('%s', (i, o) => expect(toLocalPhone(i)).toBe(o))
  it.each(['', '12345', 'abc'])('invalid %s -> null', (i) => expect(toLocalPhone(i)).toBeNull())
})
