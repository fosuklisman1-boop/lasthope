import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { AUDIT_ACTIONS } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

// Strip characters that have meaning inside a PostgREST filter expression.
function safeSearch(q: string): string {
    return q.replace(/[,()*%\\]/g, ' ').trim().slice(0, 80)
}

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sp = new URL(request.url).searchParams
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const action = sp.get('action') || ''
    const actor = sp.get('actor') || ''
    const targetId = sp.get('targetId') || ''
    const from = sp.get('from') || ''
    const to = sp.get('to') || ''
    const q = safeSearch(sp.get('q') || '')

    let query = (auth.supabase as any)
        .from('audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

    if (action) {
        if (!(AUDIT_ACTIONS as readonly string[]).includes(action) && !action.endsWith('.*')) {
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
        }
        // "wallet.*" style filters match a whole group.
        query = action.endsWith('.*') ? query.like('action', action.replace('.*', '.%')) : query.eq('action', action)
    }
    if (actor) query = query.eq('actor_id', actor)
    if (targetId) query = query.eq('target_id', targetId)
    const fromDate = from ? new Date(from) : null
    const toDate = to ? new Date(to) : null
    if ((fromDate && isNaN(fromDate.getTime())) || (toDate && isNaN(toDate.getTime()))) {
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    if (fromDate) query = query.gte('created_at', fromDate.toISOString())
    if (toDate) {
        toDate.setHours(23, 59, 59, 999)
        query = query.lte('created_at', toDate.toISOString())
    }
    if (q) query = query.or(`summary.ilike.%${q}%,actor_email.ilike.%${q}%,target_id.eq.${q}`)

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ entries: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
}
