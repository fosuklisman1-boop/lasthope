import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { RESELLER_TIERS } from '@/lib/roles'
import { logAudit } from '@/lib/audit'

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
      const v = Number(prices[t])
      const valid = Number.isFinite(v) && v > 0 && v <= 100000
      // A tier with no valid price is taken off the Upgrade page.
      const patch = valid ? { upgrade_price: Math.round(v * 100) / 100, upgradable: true } : { upgrade_price: null, upgradable: false }
      const { error } = await (supabaseAdmin as any).from('roles').update(patch).eq('slug', t)
      if (error) return NextResponse.json({ error: `Failed to update the ${t} price: ${error.message}` }, { status: 500 })
    }
    await logAudit(auth, {
      action: 'prices.update',
      targetType: 'settings',
      summary: 'Updated reseller upgrade prices',
      details: { prices },
    }, request)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
