import { normalizeGhanaPhone } from './orders'

export type MomoNetwork = 'mtn' | 'telecel' | 'airteltigo'
export type ChargeState = 'pay_offline' | 'send_otp' | 'send_voucher' | 'success' | 'failed' | 'pending'
export interface ChargeResult { state: ChargeState; message?: string; raw: any }

export class PaystackChargeError extends Error {
  /** True only when we know the charge was not created (explicit provider rejection or never sent). */
  readonly definitive: boolean
  constructor(message: string, definitive = false) {
    super(message)
    this.definitive = definitive
    this.name = 'PaystackChargeError'
  }
}

const BASE = 'https://api.paystack.co'

export function toPaystackProvider(n: MomoNetwork): 'mtn' | 'vod' | 'atl' {
  return n === 'telecel' ? 'vod' : n === 'airteltigo' ? 'atl' : 'mtn'
}

export function toLocalPhone(raw: string): string | null {
  const n = normalizeGhanaPhone(raw)
  return n ? '0' + n.slice(4) : null
}

export function mapChargeStatus(s: string | undefined): ChargeState {
  switch (s) {
    case 'pay_offline':
    case 'send_otp':
    case 'send_voucher':
    case 'success':
    case 'failed':
      return s
    case 'timeout':
      return 'failed'
    default:
      return 'pending'
  }
}

function secret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY
  if (!k) throw new PaystackChargeError('Payment provider is not configured', true)
  return k
}

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }, fetchImpl: typeof fetch): Promise<any> {
  let res: Response
  try {
    res = await fetchImpl(BASE + path, {
      method: init.method,
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch (e) {
    if (e instanceof PaystackChargeError) throw e
    throw new PaystackChargeError('Could not reach payment provider')
  }
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  if (!res.ok || !json || json.status !== true) {
    const rejected = !!json && json.status === false && res.status >= 400 && res.status < 500
    throw new PaystackChargeError(json?.message || 'Payment provider error', rejected)
  }
  return json
}

function toResult(json: any): ChargeResult {
  const d = json.data ?? {}
  return { state: mapChargeStatus(d.status), message: d.display_text || d.message || json.message, raw: json }
}

export async function createMomoCharge(
  i: { email: string; amountKobo: number; reference: string; phone: string; network: MomoNetwork },
  fetchImpl: typeof fetch = fetch,
): Promise<ChargeResult> {
  const phone = toLocalPhone(i.phone)
  if (!phone) throw new PaystackChargeError('Invalid Ghana phone number', true)
  const json = await call('/charge', {
    method: 'POST',
    body: {
      email: i.email,
      amount: i.amountKobo,
      currency: 'GHS',
      reference: i.reference,
      mobile_money: { phone, provider: toPaystackProvider(i.network) },
    },
  }, fetchImpl)
  return toResult(json)
}

export async function submitChargeOtp(i: { reference: string; code: string }, fetchImpl: typeof fetch = fetch): Promise<ChargeResult> {
  const json = await call('/charge/submit_otp', { method: 'POST', body: { otp: i.code, reference: i.reference } }, fetchImpl)
  return toResult(json)
}

export async function verifyTransaction(reference: string, fetchImpl: typeof fetch = fetch): Promise<{ state: ChargeState; amountKobo?: number; data: any }> {
  const json = await call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' }, fetchImpl)
  const d = json.data ?? {}
  return { state: mapChargeStatus(d.status), amountKobo: typeof d.amount === 'number' ? d.amount : undefined, data: d }
}
