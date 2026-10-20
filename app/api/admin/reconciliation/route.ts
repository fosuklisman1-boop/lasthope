import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { reconcile, isUpgradePayment, type PaymentRow, type CreditRow } from '@/lib/reconciliation'

export const dynamic = 'force-dynamic'

const PAYMENT_LIMIT = 2000
const CREDIT_LIMIT = 5000

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const days = Math.min(180, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30))
    const since = new Date(Date.now() - days * 86400000)
    const creditSince = new Date(since.getTime() - 86400000) // a credit can land a little after its payment
    const db = auth.supabase as any

    const [paymentsRes, creditsRes] = await Promise.all([
        db.from('wallet_payments')
            .select('id, reference, user_id, amount, status, created_at, metadata')
            .gte('created_at', since.toISOString())
            .order('created_at', { ascending: false })
            .limit(PAYMENT_LIMIT),
        db.from('wallet_transactions')
            .select('id, reference, amount, created_at')
            .eq('type', 'credit')
            .in('source', ['payment', 'reconciliation'])
            .gte('created_at', creditSince.toISOString())
            .limit(CREDIT_LIMIT),
    ])
    if (paymentsRes.error) return NextResponse.json({ error: paymentsRes.error.message }, { status: 500 })
    if (creditsRes.error) return NextResponse.json({ error: creditsRes.error.message }, { status: 500 })

    const payments = (paymentsRes.data ?? []) as PaymentRow[]
    const credits = (creditsRes.data ?? []) as CreditRow[]
    const issues = reconcile(payments, credits)

    // Attach emails so an admin can tell whose money this is.
    const userIds = Array.from(new Set(issues.map(i => i.userId).filter(Boolean))) as string[]
    const emails: Record<string, string> = {}
    if (userIds.length) {
        const { data: users } = await db.from('users').select('id, email').in('id', userIds.slice(0, 200))
        for (const u of users ?? []) emails[u.id] = u.email
    }

    const checked = payments.filter(p => !isUpgradePayment(p)).length
    const atRisk = issues
        .filter(i => i.kind === 'completed_not_credited')
        .reduce((sum, i) => sum + i.amount, 0)

    return NextResponse.json({
        days,
        checked,
        truncated: payments.length >= PAYMENT_LIMIT || credits.length >= CREDIT_LIMIT,
        atRisk: Math.round(atRisk * 100) / 100,
        issues: issues.map(i => ({ ...i, userEmail: i.userId ? emails[i.userId] ?? null : null })),
    })
}
