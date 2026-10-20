import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { parseSettingUpdates, diffSettings } from '@/lib/settings-diff'

export const dynamic = 'force-dynamic'

export async function GET() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { data, error } = await (auth.supabase.from('admin_settings') as any).select('key, value')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const settings: Record<string, string> = {}
    for (const row of data || []) settings[row.key] = row.value
    return NextResponse.json({ settings })
}

// Save settings. Fees and price adjustments change what customers pay, so only
// admins can do it, and every change is written to the audit log with before/after.
export async function PUT(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const parsed = parseSettingUpdates(body.updates)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { data: existing, error: readError } = await (auth.supabase.from('admin_settings') as any)
        .select('key, value')
        .in('key', parsed.updates.map(u => u.key))
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

    const current: Record<string, string> = {}
    for (const row of existing || []) current[row.key] = row.value

    const changes = diffSettings(current, parsed.updates)
    if (changes.length === 0) return NextResponse.json({ success: true, changed: 0 })

    const { error } = await (auth.supabase.from('admin_settings') as any).upsert(
        changes.map(c => ({ key: c.key, value: c.to }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'settings.update',
        targetType: 'settings',
        summary: `Changed ${changes.length} setting${changes.length === 1 ? '' : 's'}: ${changes.map(c => c.key).join(', ')}`.slice(0, 300),
        details: { changes },
    }, request)

    return NextResponse.json({ success: true, changed: changes.length })
}
