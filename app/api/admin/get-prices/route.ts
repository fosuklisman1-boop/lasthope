import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { RESELLER_TIERS } from '@/lib/roles'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const keys = RESELLER_TIERS.map(t => 'upgrade_price_' + t.replace(/-/g, '_'))
    const { data, error } = await supabase.from('admin_settings').select('key, value').in('key', keys)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const prices: Record<string, number> = {}
    for (const t of RESELLER_TIERS) {
      const key = 'upgrade_price_' + t.replace(/-/g, '_')
      prices[t] = parseFloat(data?.find(s => s.key === key)?.value || '0')
    }
    return NextResponse.json({ prices })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
