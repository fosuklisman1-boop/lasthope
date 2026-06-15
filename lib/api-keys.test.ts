import { describe, it, expect, beforeAll } from 'vitest'
import { generateApiKey, hashApiKey, parseBearerKey } from './api-keys'

beforeAll(() => { process.env.API_KEY_PEPPER = 'test-pepper' })

describe('api-keys', () => {
  it('generates lh_live_ keys with a stored prefix and matching hash', () => {
    const { key, prefix, hash } = generateApiKey()
    expect(key).toMatch(/^lh_live_[A-Za-z0-9_-]{43}$/)
    expect(prefix.length).toBeLessThanOrEqual(12)
    expect(key.startsWith(prefix)).toBe(true)
    expect(hash).toBe(hashApiKey(key))
  })
  it('hash is deterministic HMAC keyed by the pepper', () => {
    const h1 = hashApiKey('lh_live_abc'); const h2 = hashApiKey('lh_live_abc')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    process.env.API_KEY_PEPPER = 'other'
    expect(hashApiKey('lh_live_abc')).not.toBe(h1)
    process.env.API_KEY_PEPPER = 'test-pepper'
  })
  it('parses a valid Bearer key and rejects malformed/empty/dup headers', () => {
    expect(parseBearerKey('Bearer lh_live_' + 'a'.repeat(43))).toBe('lh_live_' + 'a'.repeat(43))
    expect(parseBearerKey(null)).toBeNull()
    expect(parseBearerKey('Bearer ')).toBeNull()
    expect(parseBearerKey('Bearer xyz')).toBeNull()
    expect(parseBearerKey('lh_live_' + 'a'.repeat(43))).toBeNull()
    expect(parseBearerKey('Bearer a, Bearer b')).toBeNull()
  })
})
