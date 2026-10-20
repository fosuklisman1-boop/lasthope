import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { loadReconciliation } from '@/lib/reconciliation-data'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const days = Math.min(180, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30))
    const db = auth.supabase as any

    let data
    try {
        data = await loadReconciliation(db, days)
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
    const { issues, checked, truncated } = data

    // Attach emails so an admin can tell whose money this is.
    const userIds = Array.from(new Set(issues.map(i => i.userId).filter(Boolean))) as string[]
    const emails: Record<string, string> = {}
    if (userIds.length) {
        const { data: users } = await db.from('users').select('id, email').in('id', userIds.slice(0, 200))
        for (const u of users ?? []) emails[u.id] = u.email
    }

    const atRisk = issues
        .filter(i => i.kind === 'completed_not_credited')
        .reduce((sum, i) => sum + i.amount, 0)

    return NextResponse.json({
        days,
        checked,
        truncated,
        atRisk: Math.round(atRisk * 100) / 100,
        issues: issues.map(i => ({ ...i, userEmail: i.userId ? emails[i.userId] ?? null : null })),
    })
}
