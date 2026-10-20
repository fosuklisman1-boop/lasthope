import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Everything an admin needs to look at one account on a single screen.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

    const db = auth.supabase as any

    const { data: user, error: userError } = await db
        .from('users')
        .select('id, email, first_name, last_name, phone_number, role, status, created_at, updated_at')
        .eq('id', id)
        .single()
    if (userError || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const [wallet, orders, orderCount, transactions, complaints, withdrawals, shop, apiKeys, notes, activity] = await Promise.all([
        db.from('wallets').select('id, balance, total_credited, total_spent').eq('user_id', id).maybeSingle(),
        db.from('orders')
            .select('id, reference_code, network, size, phone_number, price, status, payment_status, created_at')
            .eq('user_id', id).order('created_at', { ascending: false }).limit(20),
        db.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', id),
        db.from('wallet_transactions')
            .select('id, type, amount, description, source, status, reference, created_at')
            .eq('user_id', id).order('created_at', { ascending: false }).limit(30),
        db.from('complaints')
            .select('id, subject, status, created_at')
            .eq('user_id', id).order('created_at', { ascending: false }).limit(10),
        db.from('withdrawals')
            .select('id, amount, status, created_at')
            .eq('user_id', id).order('created_at', { ascending: false }).limit(10),
        db.from('shops').select('id, name, slug, is_active').eq('user_id', id).maybeSingle(),
        db.from('api_keys').select('id, key_prefix, label, status, last_used_at').eq('user_id', id).order('created_at', { ascending: false }),
        db.from('admin_notes').select('id, body, author_email, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
        db.from('audit_log')
            .select('id, created_at, actor_email, action, summary, reason')
            .or(`target_id.eq.${id},details->>userId.eq.${id}`)
            .order('created_at', { ascending: false }).limit(25),
    ])

    return NextResponse.json({
        user,
        wallet: wallet.data ?? null,
        orders: orders.data ?? [],
        orderCount: orderCount.count ?? 0,
        transactions: transactions.data ?? [],
        complaints: complaints.data ?? [],
        withdrawals: withdrawals.data ?? [],
        shop: shop.data ?? null,
        apiKeys: apiKeys.data ?? [],
        notes: notes.data ?? [],
        activity: activity.data ?? [],
    })
}
