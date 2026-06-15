import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { signWebhook } from './api-webhooks'

describe('signWebhook', () => {
  it('is HMAC-SHA512 over `${timestamp}.${body}`', () => {
    const sig = signWebhook('1700000000', '{"a":1}', 'secret')
    const expected = crypto.createHmac('sha512', 'secret').update('1700000000.{"a":1}').digest('hex')
    expect(sig).toBe(expected)
  })
})
