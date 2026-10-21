import { NextResponse } from 'next/server'
import { withApiUsage } from '@/lib/api-usage'
import { requireApiKey } from '@/lib/require-api-key'
import { resolvePrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  const { data, error } = await (auth.supabase.from('data_packages') as any)
    .select('id, network, size, description, price, agent_price, super_agent_price, premium_agent_price, dealer_price')
    .eq('is_available', true).order('network').order('sort_order')
  if (error) return NextResponse.json({ error: 'Failed to load packages', code: 'server_error' }, { status: 500 })
  let ctx
  try {
    ctx = await loadPricingContext(auth.supabase, auth.user.id, auth.user.role)
  } catch (e: any) {
    console.error('[v1/packages] pricing failed:', e?.message)
    return NextResponse.json({ error: 'Pricing unavailable', code: 'pricing_unavailable' }, { status: 503 })
  }
  const out = (data || []).map((p: any) => ({
    id: p.id, network: p.network, size: p.size, description: p.description,
    price: resolvePrice(p, ctx), currency: 'GHS',
  }))
  return NextResponse.json({ data: out })
}

export const GET = withApiUsage(handleGET)
