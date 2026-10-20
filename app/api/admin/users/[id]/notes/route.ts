import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (text.length < 1 || text.length > 2000) {
        return NextResponse.json({ error: 'A note must be between 1 and 2000 characters' }, { status: 400 })
    }

    const db = auth.supabase as any
    const { data: author } = await db.from('users').select('email').eq('id', auth.userId).single()

    const { data, error } = await db
        .from('admin_notes')
        .insert({ user_id: id, author_id: auth.userId, author_email: author?.email ?? null, body: text })
        .select('id, body, author_email, created_at')
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'user.note',
        targetType: 'user',
        targetId: id,
        summary: 'Added a note to a user account',
        details: { noteId: data.id },
    }, request)

    return NextResponse.json({ note: data })
}
