import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { parseRange, fillDays, toCsv } from '@/lib/reports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const range = parseRange(sp.get('from'), sp.get('to'))
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })

    // [from 00:00, day after "to" 00:00) in UTC, which is Ghana time.
    const fromTs = `${range.from}T00:00:00Z`
    const toTs = new Date(new Date(`${range.to}T00:00:00Z`).getTime() + 86400000).toISOString()

    const { data, error } = await (auth.supabase as any).rpc('admin_report', { p_from: fromTs, p_to: toTs })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const r = data as any
    const days = fillDays(r.by_day ?? [], range.from, range.to)

    if (sp.get('format') === 'csv') {
        const csv = toCsv(
            ['Date', 'Completed orders', 'Revenue (GHS)', 'Profit (GHS)'],
            days.map(d => [d.day, d.orders, d.revenue.toFixed(2), d.profit.toFixed(2)])
        )
        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="lasthope-report-${range.from}-to-${range.to}.csv"`,
                'Cache-Control': 'no-store',
            },
        })
    }

    const t = r.totals
    return NextResponse.json({
        from: range.from,
        to: range.to,
        totals: {
            orders: t.orders, completed: t.completed, failed: t.failed,
            revenue: Number(t.revenue), cost: Number(t.cost), profit: Number(t.revenue) - Number(t.cost),
            successRate: t.orders > 0 ? Math.round((t.completed / t.orders) * 100) : 0,
        },
        days,
        byNetwork: r.by_network ?? [],
        byTier: r.by_tier ?? [],
        topPackages: r.top_packages ?? [],
    })
}
