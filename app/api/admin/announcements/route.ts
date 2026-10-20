import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const MAX_TITLE = 120
const MAX_MESSAGE = 2000

function clean(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

// Create an announcement
export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await request.json().catch(() => ({}))
    const title = clean(body.title, MAX_TITLE)
    const message = clean(body.message, MAX_MESSAGE)
    if (!title || !message) {
        return NextResponse.json({ error: 'Title and message are required' }, { status: 400 })
    }

    const { data, error } = await (auth.supabase.from('system_announcements') as any)
        .insert({ title, message, is_active: true })
        .select()
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'announcement.post',
        targetType: 'announcement',
        targetId: String(data.id),
        summary: `Posted the announcement "${title}"`,
        details: { title },
    }, request)

    return NextResponse.json({ announcement: data })
}

// Toggle active, or edit and repost
export async function PATCH(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await request.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    let update: Record<string, unknown>
    let summary: string
    if (typeof body.is_active === 'boolean') {
        update = { is_active: body.is_active }
        summary = body.is_active ? 'Activated an announcement' : 'Deactivated an announcement'
    } else {
        const title = clean(body.title, MAX_TITLE)
        const message = clean(body.message, MAX_MESSAGE)
        if (!title || !message) {
            return NextResponse.json({ error: 'Title and message are required' }, { status: 400 })
        }
        update = { title, message, is_active: true, created_at: new Date().toISOString() }
        summary = `Edited and reposted the announcement "${title}"`
    }

    const { data, error } = await (auth.supabase.from('system_announcements') as any)
        .update(update)
        .eq('id', id)
        .select()
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'announcement.post',
        targetType: 'announcement',
        targetId: id,
        summary,
        details: { changes: update },
    }, request)

    return NextResponse.json({ announcement: data })
}

export async function DELETE(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { data: gone } = await (auth.supabase.from('system_announcements') as any).select('title').eq('id', id).single()
    const { error } = await (auth.supabase.from('system_announcements') as any).delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'announcement.post',
        targetType: 'announcement',
        targetId: id,
        summary: `Deleted the announcement "${gone?.title ?? id}"`,
    }, request)

    return NextResponse.json({ success: true })
}
