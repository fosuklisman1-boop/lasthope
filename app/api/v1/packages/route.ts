import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { getPriceForRole } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  const { data, error } = await (auth.supabase.from('data_packages') as any)
    .select('id, network, size, description, price, agent_price, super_agent_price, premium_agent_price, dealer_price')
    .eq('is_available', true).order('network').order('sort_order')
  if (error) return NextResponse.json({ error: 'Failed to load packages', code: 'server_error' }, { status: 500 })
  const out = (data || []).map((p: any) => ({
    id: p.id, network: p.network, size: p.size, description: p.description,
    price: getPriceForRole(p, auth.user.role), currency: 'GHS',
  }))
  return NextResponse.json({ data: out })
}
