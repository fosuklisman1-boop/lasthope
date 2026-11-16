import { NextRequest, NextResponse } from 'next/server'
import { isPaymentMaintenance, MAINTENANCE_MESSAGE } from '@/lib/maintenance'
import { createRouteClient } from '@/lib/supabase-server'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { createMomoCharge, toLocalPhone, PaystackChargeError, type MomoNetwork } from '@/lib/paystack-charge'
import { PayError } from '@/lib/pay/errors'
import { shouldMarkFailed } from '@/lib/pay/charge-failure'
import { prepareTopup, prepareUpgrade, prepareDirectBuy, markPaymentFailed, type PreparedPayment } from '@/lib/pay/prepare-wallet'
import { prepareStorefront, markOrderFailed } from '@/lib/pay/prepare-storefront'

const NO_STORE = { 'Cache-Control': 'no-store' }
const NETWORKS: MomoNetwork[] = ['mtn', 'telecel', 'airteltigo']
const PURPOSES = ['topup', 'storefront', 'upgrade', 'direct_buy']

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

async function limited(key: string, max: number) {
  const rl = await checkRateLimit(key, max, 60)
  if (rl.allowed) return null
  return json(
    { error: 'Too many payment attempts. Please wait a moment and try again.' },
    429,
    { 'Retry-After': String(rl.retryAfterSeconds) },
  )
}

export async function POST(request: NextRequest) {
  try {
    if (await isPaymentMaintenance()) return json({ error: MAINTENANCE_MESSAGE }, 503)

    let body: any
    try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400) }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, 400)

    const purpose = body.purpose
    if (!PURPOSES.includes(purpose)) return json({ error: 'Invalid purpose' }, 400)

    // Authenticate (never getSession) and rate limit. Email only ever comes from the authed user.
    let userId: string | undefined
    let authEmail: string | undefined
    if (purpose === 'storefront') {
      const blocked = await limited(`pay-charge-guest:${getClientIp(request)}`, 10)
      if (blocked) return blocked
    } else {
      const { data: { user }, error } = await createRouteClient().auth.getUser()
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      userId = user.id
      authEmail = user.email ?? undefined
      const blocked = await limited(`pay-charge:${userId}`, 5)
      if (blocked) return blocked
      if (!authEmail) return json({ error: 'Account has no email address' }, 400)
    }

    const network = body.network as MomoNetwork
    if (!NETWORKS.includes(network)) return json({ error: 'Select a valid mobile money network' }, 400)
    const phone = typeof body.phone === 'string' ? toLocalPhone(body.phone) : null
    if (!phone) return json({ error: 'Enter a valid Ghana phone number' }, 400)

    const sb = createServerClient() as any
    let prepared: PreparedPayment
    switch (purpose) {
      case 'topup':
        prepared = await prepareTopup(sb, { userId: userId!, email: authEmail!, amount: Number(body.amount) })
        break
      case 'upgrade':
        prepared = await prepareUpgrade(sb, { userId: userId!, email: authEmail!, tier: body.tier })
        break
      case 'direct_buy':
        prepared = await prepareDirectBuy(sb, { userId: userId!, email: authEmail!, packageId: body.packageId, phoneNumber: body.phoneNumber })
        break
      default:
        prepared = await prepareStorefront(sb, {
          packageId: body.packageId,
          phoneNumber: body.phoneNumber,
          email: body.email,
          shopId: typeof body.shopId === 'string' ? body.shopId : null,
        })
    }

    try {
      const charge = await createMomoCharge({
        email: prepared.email,
        amountKobo: Math.round(prepared.totalAmount * 100),
        reference: prepared.reference,
        phone,
        network,
      })
      return json({ reference: prepared.reference, state: charge.state })
    } catch (e) {
      if (shouldMarkFailed(e)) {
        try {
          if (purpose === 'storefront') await markOrderFailed(sb, prepared.reference)
          else await markPaymentFailed(sb, prepared.reference)
        } catch {
          console.error('[pay/charge] could not mark attempt failed')
        }
      }
      // Ambiguous errors leave the row pending; the client keeps polling status for this reference.
      if (e instanceof PaystackChargeError) return json({ error: e.message, reference: prepared.reference }, 502)
      throw e
    }
  } catch (error) {
    if (error instanceof PayError) return json({ error: error.message }, error.httpStatus)
    console.error('[pay/charge] error:', error instanceof Error ? error.name : 'unknown')
    return json({ error: 'Internal server error' }, 500)
  }
}
