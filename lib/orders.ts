import { resolvePrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { generateReferenceCode } from '@/lib/utils'

export interface PlaceOrderInput {
  userId: string
  packageId: string
  phoneNumber: string
  idempotencyKey: string
  source: string
}
export type PlaceOrderResult =
  | { ok: true; reference: string; orderId: string; price: number; network: string; size: string; status: string }
  | { ok: false; code: string; message: string; httpStatus: number }

export function normalizeGhanaPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const d = raw.replace(/[^\d+]/g, '')
  let m: RegExpMatchArray | null
  if ((m = d.match(/^\+?233(\d{9})$/))) return '+233' + m[1]
  if ((m = d.match(/^0(\d{9})$/))) return '+233' + m[1]
  return null
}

export async function placeOrder(input: PlaceOrderInput, supabase: any): Promise<PlaceOrderResult> {
  const { userId, packageId, idempotencyKey, source } = input
  if (!packageId || typeof packageId !== 'string') return { ok: false, code: 'invalid_package', message: 'package_id is required', httpStatus: 400 }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') return { ok: false, code: 'invalid_idempotency_key', message: 'idempotency_key is required', httpStatus: 400 }
  const phone = normalizeGhanaPhone(input.phoneNumber)
  if (!phone) return { ok: false, code: 'invalid_phone', message: 'phone_number must be a valid Ghana number', httpStatus: 400 }

  const { data: existing } = await supabase.from('orders').select('id, reference_code, status, price, network, size')
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing) return { ok: true, reference: existing.reference_code, orderId: existing.id, price: Number(existing.price), network: existing.network, size: existing.size, status: existing.status }

  const { data: pkg } = await supabase.from('data_packages').select('*').eq('id', packageId).eq('is_available', true).single()
  if (!pkg) return { ok: false, code: 'package_not_found', message: 'Package not found or unavailable', httpStatus: 404 }

  const { data: u, error: userErr } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
  if (userErr) return { ok: false, code: 'pricing_unavailable', message: 'Could not resolve pricing', httpStatus: 503 }
  if (!u) return { ok: false, code: 'user_not_found', message: 'Account not found', httpStatus: 404 }
  let charge: number
  try {
    charge = resolvePrice(pkg, await loadPricingContext(supabase, userId, u.role))
  } catch (e: any) {
    console.error('[placeOrder] pricing failed:', e?.message)
    return { ok: false, code: 'pricing_unavailable', message: 'Could not resolve pricing', httpStatus: 503 }
  }
  if (!(charge > 0)) return { ok: false, code: 'pricing_unavailable', message: 'This package has no valid price', httpStatus: 503 }

  const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', userId).single()
  if (!wallet) return { ok: false, code: 'wallet_not_found', message: 'Wallet not found', httpStatus: 404 }

  const { data: debit, error: debitErr } = await supabase.rpc('debit_wallet', { p_wallet_id: wallet.id, p_amount: charge }).single()
  if (debitErr || !debit) {
    if (debitErr && debitErr.code !== 'PGRST116') return { ok: false, code: 'debit_failed', message: 'Failed to debit wallet', httpStatus: 500 }
    return { ok: false, code: 'insufficient_funds', message: 'Insufficient balance', httpStatus: 402 }
  }

  const referenceCode = generateReferenceCode()
  const { data: order, error: orderErr } = await supabase.from('orders').insert({
    user_id: userId, package_id: packageId, phone_number: phone, network: pkg.network, size: pkg.size,
    bundle_name: pkg.size, price: charge, amount: charge, cost_price: pkg.cost_price || 0,
    status: 'pending', payment_status: 'paid', reference_code: referenceCode, reference: referenceCode,
    fulfillment_method: 'auto', idempotency_key: idempotencyKey,
  }).select().single()

  if (orderErr || !order) {
    await supabase.rpc('credit_wallet', { p_wallet_id: wallet.id, p_amount: charge }).single()
    return { ok: false, code: 'order_failed', message: 'Failed to create order', httpStatus: 500 }
  }

  await supabase.from('wallet_transactions').insert({
    wallet_id: wallet.id, user_id: userId, type: 'debit', amount: charge,
    description: `Data purchase: ${pkg.size} for ${phone}`, reference: referenceCode, source, status: 'completed',
  })

  return { ok: true, reference: referenceCode, orderId: order.id, price: charge, network: pkg.network, size: pkg.size, status: 'pending' }
}
