import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const GIVE_UP_AT = 6 // matches MAX_ATTEMPTS in the retry cron
const STOPPED = 99 // attempts value that takes a delivery out of the retry queue

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const status = sp.get('status') || 'failed'
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    if (!['failed', 'pending', 'delivered', 'all'].includes(status)) {
        return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    const db = auth.supabase as any

    let query = db
        .from('api_webhook_deliveries')
        .select('id, api_key_id, event, order_id, payload, status, attempts, next_attempt_at, last_response_code, created_at, updated_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (status !== 'all') query = query.eq('status', status)

    const count = (s: string) => db.from('api_webhook_deliveries').select('id', { count: 'exact', head: true }).eq('status', s)
    const [list, failed, pending, delivered] = await Promise.all([query, count('failed'), count('pending'), count('delivered')])
    if (list.error) return NextResponse.json({ error: list.error.message }, { status: 500 })

    // Attach the key and its owner.
    const rows = list.data ?? []
    const keyIds = Array.from(new Set(rows.map((r: any) => r.api_key_id)))
    const keys: Record<string, any> = {}
    if (keyIds.length) {
        const { data: keyRows } = await db.from('api_keys').select('id, key_prefix, label, webhook_url, user_id').in('id', keyIds)
        const userIds = Array.from(new Set((keyRows ?? []).map((k: any) => k.user_id)))
        const emails: Record<string, string> = {}
        if (userIds.length) {
            const { data: users } = await db.from('users').select('id, email').in('id', userIds)
            for (const u of users ?? []) emails[u.id] = u.email
        }
        for (const k of keyRows ?? []) keys[k.id] = { ...k, owner_email: emails[k.user_id] ?? null }
    }

    return NextResponse.json({
        deliveries: rows.map((r: any) => ({ ...r, key: keys[r.api_key_id] ?? null, stopped: r.status === 'failed' && r.attempts >= GIVE_UP_AT })),
        total: list.count ?? 0,
        page,
        pageSize: PAGE_SIZE,
        counts: { failed: failed.count ?? 0, pending: pending.count ?? 0, delivered: delivered.count ?? 0 },
    })
}

// retry: queue it again now. stop: take it out of the retry queue for good.
export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const { id, action } = body
    if (typeof id !== 'string' || !['retry', 'stop'].includes(action)) {
        return NextResponse.json({ error: 'id and action (retry or stop) are required' }, { status: 400 })
    }

    const db = auth.supabase as any
    const { data: row } = await db.from('api_webhook_deliveries').select('id, event, status, order_id, api_key_id').eq('id', id).single()
    if (!row) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    if (row.status === 'delivered') return NextResponse.json({ error: 'This delivery already succeeded' }, { status: 409 })

    const update = action === 'retry'
        ? { status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { status: 'failed', attempts: STOPPED, updated_at: new Date().toISOString() }

    const { error } = await db.from('api_webhook_deliveries').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'webhook.manage',
        targetType: 'webhook_delivery',
        targetId: id,
        summary: action === 'retry' ? `Queued a ${row.event} webhook for another try` : `Stopped retrying a ${row.event} webhook`,
        details: { event: row.event, orderId: row.order_id, apiKeyId: row.api_key_id },
    }, request)

    return NextResponse.json({ success: true })
}
