import { generateReferenceCode } from '@/lib/utils'
import { storefrontTotal } from './fee'
import { resolvePrice, shopPrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { loadShopControls, loadShopLimits, loadBlockedPackageIds, limitsFor, DEFAULT_SUSPENSION_MESSAGE } from '@/lib/shop-data'
import { normalizeGhanaPhone } from '@/lib/orders'
import { PayError } from './errors'
import type { PreparedPayment } from './prepare-wallet'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Price a shop sale: owner cost (their role/table/override prices) plus the shop's margin, capped. Fails closed. */
async function priceShopSale(sb: any, pkg: any, packageId: string, shopId: string): Promise<{ price: number; profit: number }> {
  const { data: shop, error: shopErr } = await sb.from('shops').select('*').eq('id', shopId).maybeSingle()
  if (shopErr) {
    console.error('[pay] shop lookup failed:', shopErr.code)
    throw new PayError('This shop is temporarily unavailable. Please try again shortly.', 503)
  }
  if (!shop) throw new PayError('Shop not found', 404)

  // Admin controls: a failure to read them refuses the sale instead of allowing it.
  let controls, limits, blocked
  try {
    ;[controls, limits, blocked] = await Promise.all([
      loadShopControls(sb, shop.id), loadShopLimits(sb), loadBlockedPackageIds(sb, shop.id),
    ])
  } catch (e: any) {
    console.error('[pay] shop controls failed:', e?.message)
    throw new PayError('This shop is temporarily unavailable. Please try again shortly.', 503)
  }
  if (controls.suspended) throw new PayError(controls.suspended_message || DEFAULT_SUSPENSION_MESSAGE, 403)
  if (blocked.has(packageId)) throw new PayError('This bundle is not available from this shop.', 400)

  try {
    const { data: owner, error: ownerErr } = await sb.from('users').select('role').eq('id', shop.user_id).maybeSingle()
    if (ownerErr) throw new Error(`owner: ${ownerErr.message}`)
    const costPrice = resolvePrice(pkg, await loadPricingContext(sb, shop.user_id, owner?.role || 'user'))
    const { data: shopConfig, error: configErr } = await sb
      .from('shop_packages').select('*').eq('shop_id', shopId).eq('package_id', packageId).maybeSingle()
    if (configErr) throw new Error(`shop config: ${configErr.message}`)
    const price = shopPrice(costPrice, shopConfig, limitsFor(controls, limits).maxMarginPercent)
    return { price, profit: round2(price - costPrice) }
  } catch (e: any) {
    // No fallback to the base price: that can undercharge or misprice a sale.
    console.error('[pay] shop pricing failed:', e?.message)
    throw new PayError('Could not resolve pricing', 503)
  }
}

export async function prepareStorefront(
  sb: any,
  i: { packageId: string; phoneNumber: string; email: string; shopId?: string | null },
): Promise<PreparedPayment> {
  const email = typeof i.email === 'string' ? i.email.trim() : ''
  if (!email) throw new PayError('Email is required', 400)
  const phone = normalizeGhanaPhone(i.phoneNumber)
  if (!phone) throw new PayError('Enter a valid Ghana phone number', 400)
  if (!i.packageId || typeof i.packageId !== 'string') throw new PayError('Package is required', 400)

  const { data: pkg } = await sb.from('data_packages').select('*').eq('id', i.packageId).eq('is_available', true).single()
  if (!pkg) throw new PayError('Package not found', 404)

  let price = Number(pkg.price) || 0
  let profit = 0
  if (i.shopId) {
    const r = await priceShopSale(sb, pkg, i.packageId, i.shopId)
    price = r.price
    profit = r.profit
  }
  if (!(price > 0)) throw new PayError('This package has no valid price', 503)

  const totalAmount = storefrontTotal(price) // price + GUEST_FEE_PERCENT, same helper the guest pages display
  const reference = `GST-${generateReferenceCode()}`

  const { error } = await sb.from('orders').insert({
    user_id: null, // guest order
    package_id: i.packageId,
    shop_id: i.shopId || null,
    profit_amount: profit,
    email,
    phone_number: phone,
    customer_phone: phone,
    network: pkg.network,
    size: pkg.size,
    price,
    amount: price,
    status: 'pending',
    payment_status: 'unpaid',
    reference_code: reference,
    reference,
    fulfillment_method: 'auto',
  })
  if (error) {
    console.error('[pay] could not create guest order:', error.code)
    throw new PayError('Failed to create order', 500)
  }
  return { reference, email, totalAmount }
}

export async function markOrderFailed(sb: any, reference: string): Promise<void> {
  await sb.from('orders').update({ payment_status: 'failed' }).eq('reference', reference).eq('status', 'pending')
}
