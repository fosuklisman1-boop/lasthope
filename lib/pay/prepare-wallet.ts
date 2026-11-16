import { calculatePaystackFee, generateReferenceCode } from '@/lib/utils'
import { resolvePrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { normalizeGhanaPhone } from '@/lib/orders'
import { PayError } from './errors'

export interface PreparedPayment {
  reference: string
  email: string
  totalAmount: number // GHS, fee included
}

const CHANNEL = 'momo_charge'

async function getOrCreateWalletId(sb: any, userId: string): Promise<string> {
  const { data: wallet } = await sb.from('wallets').select('id').eq('user_id', userId).single()
  if (wallet?.id) return wallet.id
  const { data: created } = await sb.from('wallets').insert({ user_id: userId }).select().single()
  if (!created?.id) throw new PayError('Wallet unavailable', 500)
  return created.id
}

async function loadFeePercent(sb: any, userId: string): Promise<number> {
  const { data: feeData } = await sb.from('admin_settings').select('key, value').in('key', ['paystack_fee_percent', 'agent_paystack_fee_percent'])
  const { data: u } = await sb.from('users').select('role').eq('id', userId).single()
  const feeKey = u?.role === 'agent' ? 'agent_paystack_fee_percent' : 'paystack_fee_percent'
  const setting = feeData?.find((s: any) => s.key === feeKey) || feeData?.find((s: any) => s.key === 'paystack_fee_percent')
  let feePercent = 1.95
  if (setting?.value) {
    const v = setting.value
    const parsed = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 1.95
    if (!isNaN(parsed)) feePercent = parsed
  }
  return feePercent
}

async function insertPending(sb: any, row: Record<string, any>): Promise<void> {
  const { error } = await sb.from('wallet_payments').insert({ ...row, provider: 'paystack', status: 'pending' })
  if (error) {
    console.error('[pay] could not record payment attempt:', error.code)
    throw new PayError('Failed to create payment', 500)
  }
}

export async function prepareTopup(sb: any, i: { userId: string; email: string; amount: number }): Promise<PreparedPayment> {
  if (typeof i.amount !== 'number' || !isFinite(i.amount) || i.amount < 5) throw new PayError('Minimum amount is GHS 5', 400)
  const walletId = await getOrCreateWalletId(sb, i.userId)
  const fee = calculatePaystackFee(i.amount, await loadFeePercent(sb, i.userId))
  const totalAmount = Math.round((i.amount + fee) * 100) / 100
  const reference = `WAL-${generateReferenceCode()}`
  await insertPending(sb, {
    user_id: i.userId, wallet_id: walletId, amount: i.amount, fee, total_amount: totalAmount, reference,
    metadata: { channel: CHANNEL },
  })
  return { reference, email: i.email, totalAmount }
}

export async function prepareUpgrade(sb: any, i: { userId: string; email: string; tier: string }): Promise<PreparedPayment> {
  if (typeof i.tier !== 'string' || !i.tier) throw new PayError('Invalid tier', 400)
  const { data: dbUser } = await sb.from('users').select('role').eq('id', i.userId).single()
  const { data: currentRole } = await sb.from('roles').select('slug, is_reseller').eq('slug', dbUser?.role ?? '').maybeSingle()
  if (!currentRole || !(currentRole.slug === 'user' || currentRole.is_reseller)) {
    throw new PayError('Upgrades are only available to customers and existing reseller tiers.', 400)
  }
  const { data: target } = await sb.from('roles').select('slug, label, upgrade_price, upgradable').eq('slug', i.tier).maybeSingle()
  if (!target || !target.upgradable || ['admin', 'sub-admin', 'user'].includes(target.slug)) throw new PayError('Invalid tier', 400)
  const price = Number(target.upgrade_price)
  if (!price || price <= 0) throw new PayError('Upgrade price not configured for ' + i.tier, 400)

  const walletId = await getOrCreateWalletId(sb, i.userId)
  const reference = 'upgrade_' + generateReferenceCode()
  await insertPending(sb, {
    user_id: i.userId, wallet_id: walletId, amount: price, fee: 0, total_amount: price, reference,
    metadata: { user_id: i.userId, target_role: i.tier, channel: CHANNEL },
  })
  return { reference, email: i.email, totalAmount: price }
}

export async function prepareDirectBuy(
  sb: any,
  i: { userId: string; email: string; packageId: string; phoneNumber: string },
): Promise<PreparedPayment> {
  const phone = normalizeGhanaPhone(i.phoneNumber)
  if (!phone) throw new PayError('Enter a valid Ghana phone number', 400)
  if (!i.packageId || typeof i.packageId !== 'string') throw new PayError('Package is required', 400)

  const { data: pkg } = await sb.from('data_packages').select('*').eq('id', i.packageId).eq('is_available', true).single()
  if (!pkg) throw new PayError('Package not found', 404)

  const { data: u, error: userErr } = await sb.from('users').select('role').eq('id', i.userId).maybeSingle()
  if (userErr) throw new PayError('Could not resolve pricing', 503)
  if (!u) throw new PayError('Account not found', 404)
  let price: number
  try {
    price = resolvePrice(pkg, await loadPricingContext(sb, i.userId, u.role))
  } catch (e: any) {
    console.error('[pay] pricing failed:', e?.message)
    throw new PayError('Could not resolve pricing', 503)
  }
  if (!(price > 0)) throw new PayError('This package has no valid price', 503)

  const walletId = await getOrCreateWalletId(sb, i.userId)
  const fee = calculatePaystackFee(price, await loadFeePercent(sb, i.userId))
  const totalAmount = Math.round((price + fee) * 100) / 100
  const reference = `DBY-${generateReferenceCode()}`
  await insertPending(sb, {
    user_id: i.userId, wallet_id: walletId, amount: price, fee, total_amount: totalAmount, reference,
    metadata: { package_id: i.packageId, phone_number: phone, channel: CHANNEL },
  })
  return { reference, email: i.email, totalAmount }
}

export async function markPaymentFailed(sb: any, reference: string): Promise<void> {
  await sb.from('wallet_payments').update({ status: 'failed' }).eq('reference', reference).eq('status', 'pending')
}
