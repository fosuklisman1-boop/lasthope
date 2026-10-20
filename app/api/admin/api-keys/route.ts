import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const supabaseService = auth.supabase

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
        const offset = parseInt(searchParams.get('offset') || '0', 10)

        let query = supabaseService
            .from('api_keys')
            .select(
                'id, user_id, key_prefix, label, status, rate_limit_per_min, created_at, last_used_at, webhook_url',
                { count: 'exact' }
            )
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (status) {
            query = query.eq('status', status)
        }

        const { data: keys, error: keysError, count } = await query

        if (keysError) {
            console.error('[AdminApiKeysFetch] Error:', keysError)
            return NextResponse.json({
                error: keysError.message,
                details: keysError.details,
                hint: keysError.hint
            }, { status: 500 })
        }

        // Manual join to avoid relationship-cache issues — same pattern as withdrawals route
        if (keys && keys.length > 0) {
            const userIds = [...new Set(keys.map((k: any) => k.user_id))]
            const { data: users } = await supabaseService
                .from('users')
                .select('id, email')
                .in('id', userIds)

            const userMap = (users || []).reduce((acc: any, u: any) => {
                acc[u.id] = u
                return acc
            }, {})

            keys.forEach((k: any) => {
                k.users = userMap[k.user_id] || null
            })
        }

        return NextResponse.json({
            keys: keys || [],
            total: count ?? 0
        })
    } catch (error: any) {
        console.error('[AdminApiKeysFetch] Critical Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const supabaseService = auth.supabase

        const body = await request.json()
        const { id, action, rate_limit_per_min } = body

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 })
        }

        if (!['approve', 'revoke'].includes(action)) {
            return NextResponse.json({ error: "action must be 'approve' or 'revoke'" }, { status: 400 })
        }

        const update: Record<string, any> =
            action === 'approve'
                ? {
                      status: 'active',
                      approved_at: new Date().toISOString(),
                      approved_by: auth.userId
                  }
                : { status: 'revoked' }

        if (typeof rate_limit_per_min === 'number' && rate_limit_per_min > 0) {
            update.rate_limit_per_min = rate_limit_per_min
        }

        const { error } = await supabaseService
            .from('api_keys')
            .update(update)
            .eq('id', id)

        if (error) {
            console.error('[AdminApiKeysPatch] Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        await logAudit(auth, {
            action: action === 'approve' ? 'api_key.approve' : 'api_key.revoke',
            targetType: 'api_key',
            targetId: String(id),
            summary: action === 'approve' ? 'Approved a developer API key' : 'Revoked a developer API key',
            details: { action, rate_limit_per_min: update.rate_limit_per_min },
        }, request)

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
