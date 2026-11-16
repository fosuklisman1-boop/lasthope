import type { PayPurpose } from './errors'

/** Which completion function a payment reference belongs to. Pure (no server imports). */
export function purposeFromReference(ref: string, metadata?: any): PayPurpose {
  if (ref.startsWith('GST-')) return 'storefront'
  if (ref.startsWith('DBY-')) return 'direct_buy'
  if (ref.startsWith('upgrade_') || ref.startsWith('agent_upgrade_') || metadata?.target_role) return 'upgrade'
  return 'topup'
}
