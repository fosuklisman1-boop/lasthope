import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { signPaystackBody, buildChargeSuccessEvent } from './webhook-signing'

// Mirrors the verification in app/api/webhooks/paystack/route.ts
function webhookAccepts(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(signature || '', 'utf8')
  const hashBuf = Buffer.from(hash, 'utf8')
  return hashBuf.length === sigBuf.length && crypto.timingSafeEqual(hashBuf, sigBuf)
}

describe('signPaystackBody', () => {
  it('equals an independently computed HMAC-SHA512 hex', () => {
    const expected = crypto.createHmac('sha512', 'sk_test_abc').update('{"a":1}').digest('hex')
    expect(signPaystackBody('{"a":1}', 'sk_test_abc')).toBe(expected)
  })
  it('changes when body or secret changes', () => {
    const base = signPaystackBody('{"a":1}', 's1')
    expect(signPaystackBody('{"a":2}', 's1')).not.toBe(base)
    expect(signPaystackBody('{"a":1}', 's2')).not.toBe(base)
  })
  it('is accepted by the webhook verification, and rejected when tampered', () => {
    const { body } = buildChargeSuccessEvent({ reference: 'DBY-1', amountKobo: 500 })
    const sig = signPaystackBody(body, 'secret')
    expect(webhookAccepts(body, sig, 'secret')).toBe(true)
    expect(webhookAccepts(body + ' ', sig, 'secret')).toBe(false)
    expect(webhookAccepts(body, sig, 'other')).toBe(false)
  })
})

describe('buildChargeSuccessEvent', () => {
  it('builds a charge.success body with reference and amount', () => {
    const { body } = buildChargeSuccessEvent({ reference: 'GST-9', amountKobo: 1234 })
    const e = JSON.parse(body)
    expect(e.event).toBe('charge.success')
    expect(e.data.reference).toBe('GST-9')
    expect(e.data.amount).toBe(1234)
    expect(e.data.status).toBe('success')
    expect(e.data.currency).toBe('GHS')
  })
})
