import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { RESELLER_TIERS } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const supabaseAdmin = auth.supabase

    const { prices } = await request.json()
    if (!prices) return NextResponse.json({ error: 'Prices are required' }, { status: 400 })

    for (const t of RESELLER_TIERS) {
      if (prices[t] === undefined) continue
      const key = 'upgrade_price_' + t.replace(/-/g, '_')
      await supabaseAdmin.from('admin_settings').delete().eq('key', key)
      const { error } = await supabaseAdmin.from('admin_settings').insert({ key, value: String(prices[t]) } as any)
      if (error) return NextResponse.json({ error: `Failed to update ${key}: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
