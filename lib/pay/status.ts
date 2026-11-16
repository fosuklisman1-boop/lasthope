import { verifyTransaction, PaystackChargeError, type ChargeState } from '@/lib/paystack-charge'
import {
  processCompletedWalletPayment,
  processCompletedUpgradePayment,
  processCompletedShopOrder,
  processCompletedDirectBuy,
} from '@/lib/payments'
import { PayError, type PayPurpose } from './errors'

export type PayState = ChargeState | 'paid_order_failed'
export interface Caller { userId?: string; email?: string }

const NOT_FOUND = 'Payment not found'

export function purposeFromReference(ref: string, metadata?: any): PayPurpose {
  if (ref.startsWith('GST-')) return 'storefront'
  if (ref.startsWith('DBY-')) return 'direct_buy'
  if (ref.startsWith('upgrade_') || ref.startsWith('agent_upgrade_') || metadata?.target_role) return 'upgrade'
  return 'topup'
}

/** Loads the payment record for `reference` and checks the caller owns it. Unknown and unowned both throw the same 404. */
async function loadOwned(sb: any, reference: string, caller: Caller): Promise<{ metadata?: any }> {
  if (typeof reference !== 'string' || !reference) throw new PayError(NOT_FOUND, 404)

  if (reference.startsWith('GST-')) {
    const want = typeof caller.email === 'string' ? caller.email.trim().toLowerCase() : ''
    if (!want) throw new PayError(NOT_FOUND, 404)
    const { data: order } = await sb.from('orders').select('email').eq('reference', reference).maybeSingle()
    const have = typeof order?.email === 'string' ? order.email.trim().toLowerCase() : ''
    if (!have || have !== want) throw new PayError(NOT_FOUND, 404)
    return {}
  }

  if (!caller.userId) throw new PayError(NOT_FOUND, 404)
  const { data: payment } = await sb.from('wallet_payments').select('user_id, metadata').eq('reference', reference).maybeSingle()
  if (!payment || payment.user_id !== caller.userId) throw new PayError(NOT_FOUND, 404)
  return { metadata: payment.metadata }
}

export async function assertOwner(sb: any, reference: string, caller: Caller): Promise<void> {
  await loadOwned(sb, reference, caller)
}

export async function getPaymentState(
  sb: any,
  reference: string,
  caller: Caller,
  deps: { verify?: typeof verifyTransaction } = {},
): Promise<{ state: PayState; message?: string }> {
  const { metadata } = await loadOwned(sb, reference, caller)
  const verify = deps.verify ?? verifyTransaction

  let v: Awaited<ReturnType<typeof verifyTransaction>>
  try {
    v = await verify(reference)
  } catch (e) {
    // Provider unreachable / not yet aware of the reference: keep polling.
    if (e instanceof PaystackChargeError) return { state: 'pending' }
    throw e
  }

  if (v.state !== 'success') return { state: v.state }

  // Never complete without Paystack's reported amount: the process functions
  // compare it to the expected total, and the wallet path skips that check
  // when the amount is absent.
  if (typeof v.amountKobo !== 'number') {
    console.error(`[pay/status] success without amount for ${reference}; not processing`)
    return { state: 'pending' }
  }
  const providerData = { ...(v.data ?? {}), amount: v.amountKobo }

  let result: { success: boolean; error?: string; orderFailed?: boolean; pending?: boolean }
  switch (purposeFromReference(reference, metadata)) {
    case 'storefront': result = await processCompletedShopOrder(reference, providerData); break
    case 'direct_buy': result = await processCompletedDirectBuy(reference, providerData, sb); break
    case 'upgrade': result = await processCompletedUpgradePayment(reference, providerData); break
    default: result = await processCompletedWalletPayment(reference, providerData)
  }

  if (!result.success) {
    if (result.error === 'Amount mismatch') return { state: 'failed', message: 'Payment amount did not match. Contact support.' }
    console.error(`[pay/status] completion failed for ${reference}: ${result.error}`)
    return { state: 'pending', message: 'Payment received, finishing up.' }
  }
  // Paid, but the wallet credit has not been confirmed yet: keep polling.
  if (result.pending) return { state: 'pending', message: 'Payment received, finishing up.' }
  if (result.orderFailed) {
    return { state: 'paid_order_failed', message: 'Payment received and added to your wallet, but the order could not be placed.' }
  }
  return { state: 'success' }
}
