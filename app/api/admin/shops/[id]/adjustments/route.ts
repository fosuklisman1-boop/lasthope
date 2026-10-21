import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { checkAdjustment, parseConfirmAbove } from '@/lib/adjustments'
import { loadShopBalance } from '@/lib/shop-data'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Change a shop's profit. Every entry goes into an append-only ledger with its reason.
//   { type: 'credit' | 'debit', amount, reason, confirmLarge? }  add or take away profit
//   { type: 'reverse_order', orderId, reason }                   cancel the profit of one order
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid shop' }, { status: 400 })
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const type = body.type
    if (!['credit', 'debit', 'reverse_order'].includes(type)) {
        return NextResponse.json({ error: 'type must be credit, debit or reverse_order' }, { status: 400 })
    }

    const { data: shop } = await db.from('shops').select('id, user_id, name').eq('id', id).maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    let amount: number
    let reason: string
    let kind: 'adjustment' | 'order_reversal'
    let orderId: string | null = null
    let summary: string

    if (type === 'reverse_order') {
        const candidate = typeof body.orderId === 'string' ? body.orderId : ''
        if (!UUID_RE.test(candidate)) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
        orderId = candidate
        reason = typeof body.reason === 'string' ? body.reason.trim() : ''
        if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

        const { data: order } = await db.from('orders').select('id, shop_id, reference_code, profit_amount, payment_status').eq('id', orderId).maybeSingle()
        if (!order || order.shop_id !== id) return NextResponse.json({ error: 'That order is not one of this shop\'s current orders. Orders older than 14 days are archived; use a debit instead.' }, { status: 404 })
        if (order.payment_status !== 'paid') return NextResponse.json({ error: 'Only paid orders earn profit, so there is nothing to cancel on this one' }, { status: 409 })
        const profit = Number(order.profit_amount) || 0
        if (profit === 0) return NextResponse.json({ error: 'This order has no profit to cancel' }, { status: 409 })

        amount = -Math.round(profit * 100) / 100
        kind = 'order_reversal'
        summary = `Cancelled the GHS ${Math.abs(amount).toFixed(2)} profit on order ${order.reference_code} for "${shop.name}"`
    } else {
        const { data: thresholdRow } = await db.from('admin_settings').select('value').eq('key', 'wallet_adjustment_confirm_above').maybeSingle()
        const check = checkAdjustment({
            amount: body.amount, reason: body.reason, confirmLarge: body.confirmLarge === true,
            confirmAbove: parseConfirmAbove(thresholdRow?.value),
        })
        if (!check.ok) {
            return NextResponse.json({ error: check.error, code: check.code }, { status: check.code === 'needs_confirmation' ? 409 : 400 })
        }
        reason = check.reason
        amount = type === 'credit' ? check.amount : -check.amount
        kind = 'adjustment'
        summary = `${type === 'credit' ? 'Added' : 'Took away'} GHS ${check.amount.toFixed(2)} ${type === 'credit' ? 'to' : 'from'} the profit of "${shop.name}"`
    }

    const { error } = await db.from('shop_adjustments').insert({ shop_id: id, kind, amount, reason, order_id: orderId, created_by: auth.userId })
    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'The profit on this order was already cancelled' }, { status: 409 })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let balance = null
    try { balance = await loadShopBalance(db, id, shop.user_id) } catch { /* the entry is saved either way */ }

    await logAudit(auth, {
        action: 'shop.adjust', targetType: 'shop', targetId: id, summary,
        details: { shop: shop.name, kind, amount, orderId, available: balance?.available ?? null }, reason,
    }, request)

    try {
        await db.from('notifications').insert({
            user_id: shop.user_id, title: 'Your shop profit was adjusted',
            message: `${amount > 0 ? 'Added' : 'Removed'} GHS ${Math.abs(amount).toFixed(2)}. ${reason}`,
            type: 'shop_update', action_url: '/dashboard/my-shop', is_read: false,
        })
    } catch (e: any) {
        console.error('[admin/shops] notification failed:', e?.message)
    }

    return NextResponse.json({ success: true, amount, balance })
}
