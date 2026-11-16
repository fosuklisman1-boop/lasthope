import { describe, it, expect, beforeEach } from 'vitest'
import {
  toPaystackProvider, toLocalPhone, mapChargeStatus, createMomoCharge,
  submitChargeOtp, verifyTransaction, PaystackChargeError,
} from './paystack-charge'

function fakeFetch(body: any, ok = true, status = ok ? 200 : 400) {
  const calls: { url: string; init: any }[] = []
  const impl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return { ok, status, json: async () => body } as any
  }) as unknown as typeof fetch
  return { impl, calls }
}

beforeEach(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_test_x' })

describe('helpers', () => {
  it('maps providers', () => {
    expect(toPaystackProvider('telecel')).toBe('vod')
    expect(toPaystackProvider('airteltigo')).toBe('atl')
    expect(toPaystackProvider('mtn')).toBe('mtn')
  })
  it('local phone', () => {
    expect(toLocalPhone('+233551234987')).toBe('0551234987')
    expect(toLocalPhone('0551234987')).toBe('0551234987')
    expect(toLocalPhone('12345')).toBeNull()
  })
  it('maps status', () => {
    expect(mapChargeStatus('pay_offline')).toBe('pay_offline')
    expect(mapChargeStatus('send_otp')).toBe('send_otp')
    expect(mapChargeStatus('success')).toBe('success')
    expect(mapChargeStatus('failed')).toBe('failed')
    expect(mapChargeStatus('timeout')).toBe('failed')
    expect(mapChargeStatus('send_voucher')).toBe('send_voucher')
    expect(mapChargeStatus('weird')).toBe('pending')
    expect(mapChargeStatus(undefined)).toBe('pending')
  })
})

describe('createMomoCharge', () => {
  const input = { email: 'a@b.com', amountKobo: 2039, reference: 'ref1', phone: '+233551234987', network: 'mtn' as const }
  it('posts the charge', async () => {
    const f = fakeFetch({ status: true, data: { status: 'pay_offline' } })
    const r = await createMomoCharge(input, f.impl)
    expect(r.state).toBe('pay_offline')
    expect(f.calls[0].url).toBe('https://api.paystack.co/charge')
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer sk_test_x')
    expect(JSON.parse(f.calls[0].init.body)).toEqual({
      email: 'a@b.com', amount: 2039, currency: 'GHS', reference: 'ref1',
      mobile_money: { phone: '0551234987', provider: 'mtn' },
    })
  })
  it('throws with paystack message', async () => {
    const f = fakeFetch({ status: false, message: 'Bad thing' }, false)
    await expect(createMomoCharge(input, f.impl)).rejects.toThrow(PaystackChargeError)
    await expect(createMomoCharge(input, f.impl)).rejects.toThrow('Bad thing')
  })
  it('throws on bad phone before fetch', async () => {
    const f = fakeFetch({})
    await expect(createMomoCharge({ ...input, phone: '123' }, f.impl)).rejects.toThrow(PaystackChargeError)
    expect(f.calls.length).toBe(0)
  })
})

describe('submitChargeOtp', () => {
  it('posts otp', async () => {
    const f = fakeFetch({ status: true, data: { status: 'success' } })
    const r = await submitChargeOtp({ reference: 'ref1', code: '123456' }, f.impl)
    expect(r.state).toBe('success')
    expect(f.calls[0].url).toBe('https://api.paystack.co/charge/submit_otp')
    expect(JSON.parse(f.calls[0].init.body)).toEqual({ otp: '123456', reference: 'ref1' })
  })
})

describe('verifyTransaction', () => {
  it('gets verify', async () => {
    const f = fakeFetch({ status: true, data: { status: 'success', amount: 2039 } })
    const r = await verifyTransaction('ref1', f.impl)
    expect(f.calls[0].url).toBe('https://api.paystack.co/transaction/verify/ref1')
    expect(r.state).toBe('success')
    expect(r.amountKobo).toBe(2039)
  })
})

describe('PaystackChargeError.definitive', () => {
  const input = { email: 'a@b.com', amountKobo: 2039, reference: 'ref1', phone: '0551234987', network: 'mtn' as const }
  const caught = async (p: Promise<unknown>) => { try { await p } catch (e) { return e as PaystackChargeError } throw new Error('did not throw') }

  it('network failure is not definitive', async () => {
    const impl = (async () => { throw new Error('ECONNRESET') }) as unknown as typeof fetch
    expect((await caught(createMomoCharge(input, impl))).definitive).toBe(false)
  })
  it('5xx is not definitive', async () => {
    const f = fakeFetch({ status: false, message: 'oops' }, false, 503)
    expect((await caught(createMomoCharge(input, f.impl))).definitive).toBe(false)
  })
  it('unparseable body is not definitive', async () => {
    const impl = (async () => ({ ok: false, status: 400, json: async () => { throw new Error('bad json') } })) as unknown as typeof fetch
    expect((await caught(createMomoCharge(input, impl))).definitive).toBe(false)
  })
  it('explicit rejection on 4xx is definitive', async () => {
    const f = fakeFetch({ status: false, message: 'Declined' }, false, 400)
    expect((await caught(createMomoCharge(input, f.impl))).definitive).toBe(true)
  })
  it('invalid phone is definitive', async () => {
    const f = fakeFetch({})
    expect((await caught(createMomoCharge({ ...input, phone: '123' }, f.impl))).definitive).toBe(true)
  })
  it('missing secret key is definitive', async () => {
    delete process.env.PAYSTACK_SECRET_KEY
    const f = fakeFetch({})
    expect((await caught(createMomoCharge(input, f.impl))).definitive).toBe(true)
  })
})
