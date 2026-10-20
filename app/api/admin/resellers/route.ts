import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { classifyTrend, type ResellerActivity } from '@/lib/reports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const requested = parseInt(new URL(request.url).searchParams.get('days') || '30', 10)
    const days = [7, 30, 90].includes(requested) ? requested : 30

    const { data, error } = await (auth.supabase as any).rpc('admin_reseller_activity', { p_days: days })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const resellers = ((data ?? []) as ResellerActivity[])
        .map(r => ({
            ...r,
            orders_cur: Number(r.orders_cur), orders_prev: Number(r.orders_prev),
            revenue_cur: Number(r.revenue_cur), revenue_prev: Number(r.revenue_prev),
            ...classifyTrend(r),
        }))
        .sort((a, b) => b.revenue_cur - a.revenue_cur || b.revenue_prev - a.revenue_prev)

    const count = (t: string) => resellers.filter(r => r.trend === t).length
    return NextResponse.json({
        days,
        resellers,
        summary: {
            total: resellers.length,
            growing: count('growing'), declining: count('declining'), churned: count('churned'), inactive: count('inactive'),
        },
    })
}
