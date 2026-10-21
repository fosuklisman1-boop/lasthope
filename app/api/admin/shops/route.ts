import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { loadShopLimits } from '@/lib/shop-data'
import { computeBalance } from '@/lib/shop-rules'

export const dynamic = 'force-dynamic'

// Every shop with its owner, sales, profit and what an admin has restricted.
export async function GET() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const [shopsRes, summaryRes, controlsRes] = await Promise.all([
        db.from('shops').select('id, user_id, name, slug, is_active, created_at').order('created_at', { ascending: false }),
        db.rpc('admin_shop_summary'),
        db.from('shop_controls').select('shop_id, suspended, withdrawals_held, max_margin_percent, min_withdrawal, profile_locked'),
    ])
    if (shopsRes.error) return NextResponse.json({ error: shopsRes.error.message }, { status: 500 })
    if (summaryRes.error) return NextResponse.json({ error: summaryRes.error.message }, { status: 500 })

    const shops = shopsRes.data ?? []
    const ownerIds = Array.from(new Set(shops.map((s: any) => s.user_id)))
    const owners = new Map<string, any>()
    if (ownerIds.length) {
        const { data: users } = await db.from('users').select('id, email, first_name, last_name, status').in('id', ownerIds)
        for (const u of users ?? []) owners.set(u.id, u)
    }
    const summary = new Map<string, any>((summaryRes.data ?? []).map((r: any) => [r.shop_id, r]))
    const controls = new Map<string, any>((controlsRes.data ?? []).map((c: any) => [c.shop_id, c]))

    let limits = null
    try { limits = await loadShopLimits(db) } catch { /* shown as not set */ }

    return NextResponse.json({
        limits,
        shops: shops.map((s: any) => {
            const sm = summary.get(s.id) ?? {}
            const c = controls.get(s.id)
            const o = owners.get(s.user_id)
            const bal = computeBalance({
                orderProfit: Number(sm.order_profit) || 0, ledger: Number(sm.ledger) || 0,
                withdrawn: Number(sm.withdrawn) || 0, pending: Number(sm.pending) || 0,
            })
            return {
                id: s.id, name: s.name, slug: s.slug, ownerActive: s.is_active, createdAt: s.created_at,
                owner: o ? { id: o.id, email: o.email, name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim() || o.email, status: o.status } : null,
                paidOrders: Number(sm.paid_orders) || 0, sales: Number(sm.sales) || 0, lastSale: sm.last_sale ?? null,
                totalEarnings: bal.totalEarnings, available: bal.available, pendingWithdrawal: bal.pending, withdrawn: bal.withdrawn,
                suspended: !!c?.suspended, withdrawalsHeld: !!c?.withdrawals_held, profileLocked: !!c?.profile_locked,
                maxMarginPercent: c?.max_margin_percent === null || c?.max_margin_percent === undefined ? null : Number(c.max_margin_percent),
                minWithdrawal: c?.min_withdrawal === null || c?.min_withdrawal === undefined ? null : Number(c.min_withdrawal),
            }
        }),
    })
}
