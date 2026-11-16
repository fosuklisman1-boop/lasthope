// Paystack fee rules shared by the server (prepare-*) and the client previews.
// Pure and client-safe: no server imports.
import { calculatePaystackFee } from '@/lib/utils'

export const DEFAULT_FEE_PERCENT = 1.95
/** Storefront / guest purchases always use this rate. */
export const GUEST_FEE_PERCENT = 1.95
export const FEE_SETTING_KEYS = ['paystack_fee_percent', 'agent_paystack_fee_percent'] as const

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Picks the fee percent for a role from admin_settings rows. This is the server rule
 * (prepare-wallet loadFeePercent): only role === 'agent' uses the agent key, falling
 * back to the standard key, then to 1.95.
 */
export function pickFeePercent(settings: { key: string; value: unknown }[] | null | undefined, role: string | null | undefined): number {
  const feeKey = role === 'agent' ? 'agent_paystack_fee_percent' : 'paystack_fee_percent'
  const setting = settings?.find((s) => s.key === feeKey) || settings?.find((s) => s.key === 'paystack_fee_percent')
  let feePercent = DEFAULT_FEE_PERCENT
  if (setting?.value) {
    const v = setting.value
    const parsed = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : DEFAULT_FEE_PERCENT
    if (!isNaN(parsed)) feePercent = parsed
  }
  return feePercent
}

/** Amount a guest is charged for a storefront package (price + 1.95% fee), as prepareStorefront computes it. */
export function storefrontTotal(price: number): number {
  return round2(price + calculatePaystackFee(price, GUEST_FEE_PERCENT))
}
