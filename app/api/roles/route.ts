import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Public: names, colours and upgrade prices of roles. Upgrade prices were already public (the
// Upgrade page reads them). Price tables and who holds each role are NOT included.
export async function GET() {
    const { data, error } = await (createServerClient() as any)
        .from('roles')
        .select('slug, label, kind, is_reseller, color, icon, rank, upgradable, upgrade_price')
        .order('rank', { ascending: true })
    if (error) return NextResponse.json({ error: 'Roles unavailable' }, { status: 503 })

    const roles = (data ?? []).map((r: any) => ({ ...r, upgrade_price: r.upgrade_price === null ? null : Number(r.upgrade_price) }))
    return NextResponse.json({ roles }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } })
}
