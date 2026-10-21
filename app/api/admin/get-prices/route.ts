import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { RESELLER_TIERS } from '@/lib/roles'

export async function GET() {
  try {
    const { data, error } = await (createServerClient() as any).from('roles').select('slug, upgrade_price').in('slug', RESELLER_TIERS)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const prices: Record<string, number> = {}
    for (const t of RESELLER_TIERS) {
      prices[t] = Number(data?.find((r: any) => r.slug === t)?.upgrade_price ?? 0)
    }
    return NextResponse.json({ prices })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
