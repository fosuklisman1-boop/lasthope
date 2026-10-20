import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { isUpgradePayment } from '@/lib/reconciliation'
import { processCompletedWalletPayment } from '@/lib/payments'

export const dynamic = 'force-dynamic'

async function paystackVerify(reference: string): Promise<{ ok: boolean; data?: any; error?: string }> {
    const key = process.env.PAYSTACK_SECRET_KEY
    if (!key) return { ok: false, error: 'Paystack is not configured on the server' }
    try {
        const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: { Authorization: `Bearer ${key}` },
            cache: 'no-store',
        })
        const json = await res.json()
        if (!json?.status) return { ok: false, error: json?.message || 'Paystack could not find this payment' }
        return { ok: true, data: json.data }
    } catch (e: any) {
        return { ok: false, error: `Could not reach Paystack: ${e.message}` }
    }
}

// Two repairs, both re-checked against Paystack first:
//  - "verify": a payment stuck in pending. Ask Paystack and finish or fail it.
//  - "credit": a completed payment whose wallet credit is missing. Credit it once.
export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const { paymentId, action } = body
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (typeof paymentId !== 'string' || !['verify', 'credit'].includes(action)) {
        return NextResponse.json({ error: 'paymentId and action (verify or credit) are required' }, { status: 400 })
    }
    if (reason.length < 5) {
        return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })
    }

    const db = auth.supabase as any
    const { data: payment, error: payError } = await db.from('wallet_payments').select('*').eq('id', paymentId).single()
    if (payError || !payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (isUpgradePayment(payment)) {
        return NextResponse.json({ error: 'Role-upgrade payments are not handled here' }, { status: 400 })
    }

    const audit = (summary: string, details: Record<string, unknown>) =>
        logAudit(auth, {
            action: 'payment.reconcile',
            targetType: 'payment',
            targetId: paymentId,
            summary,
            details: { reference: payment.reference, userId: payment.user_id, amount: payment.amount, ...details },
            reason,
        }, request)

    // ── Stuck pending: ask Paystack ──────────────────────────────────────
    if (action === 'verify') {
        if (payment.status !== 'pending') {
            return NextResponse.json({ error: `This payment is ${payment.status}, not pending` }, { status: 409 })
        }
        const v = await paystackVerify(payment.reference)
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 502 })

        const remote = v.data?.status
        if (remote === 'success') {
            const result = await processCompletedWalletPayment(payment.reference, v.data)
            if (!result.success) return NextResponse.json({ error: result.error || 'Could not complete the payment' }, { status: 500 })
            await audit(`Completed a stuck payment of GHS ${Number(payment.amount).toFixed(2)} after checking Paystack`, { outcome: 'completed' })
            return NextResponse.json({ outcome: 'completed' })
        }
        if (remote === 'failed' || remote === 'abandoned') {
            await db.from('wallet_payments')
                .update({ status: 'failed', metadata: { ...(payment.metadata || {}), provider_data: v.data }, updated_at: new Date().toISOString() })
                .eq('id', paymentId)
                .eq('status', 'pending')
            await audit(`Marked a stuck payment of GHS ${Number(payment.amount).toFixed(2)} as failed (Paystack: ${remote})`, { outcome: 'failed', remote })
            return NextResponse.json({ outcome: 'failed' })
        }
        return NextResponse.json({ outcome: 'still_pending', remote })
    }

    // ── Paid but not credited ────────────────────────────────────────────
    if (payment.status !== 'completed') {
        return NextResponse.json({ error: `This payment is ${payment.status}, not completed` }, { status: 409 })
    }

    const { data: existing } = await db
        .from('wallet_transactions')
        .select('id')
        .eq('reference', payment.reference)
        .eq('type', 'credit')
        .limit(1)
    if (existing && existing.length > 0) {
        return NextResponse.json({ error: 'A credit already exists for this payment' }, { status: 409 })
    }

    // Never credit on our own say-so: Paystack must confirm the money and the amount.
    const v = await paystackVerify(payment.reference)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 502 })
    if (v.data?.status !== 'success') {
        return NextResponse.json({ error: `Paystack reports this payment as ${v.data?.status ?? 'unknown'}, so it was not credited` }, { status: 409 })
    }
    const expectedKobo = Math.round(Number(payment.total_amount ?? payment.amount) * 100)
    if (v.data?.amount !== expectedKobo) {
        return NextResponse.json({ error: 'Paystack charged a different amount than this payment expects. Review it manually.' }, { status: 409 })
    }

    // Claim the reference first. The unique index makes a second attempt fail here,
    // so a double click or a race cannot credit twice.
    const { data: claim, error: claimError } = await db
        .from('wallet_transactions')
        .insert({
            wallet_id: payment.wallet_id,
            user_id: payment.user_id,
            type: 'credit',
            amount: payment.amount,
            description: 'Wallet top-up via Paystack (reconciled by admin)',
            reference: payment.reference,
            source: 'reconciliation',
            status: 'completed',
        })
        .select('id')
        .single()
    if (claimError) {
        if (claimError.code === '23505') return NextResponse.json({ error: 'A credit already exists for this payment' }, { status: 409 })
        return NextResponse.json({ error: claimError.message }, { status: 500 })
    }

    const { data: credited, error: creditError } = await db
        .rpc('credit_wallet', { p_wallet_id: payment.wallet_id, p_amount: payment.amount })
        .single()
    if (creditError || !credited) {
        await db.from('wallet_transactions').delete().eq('id', claim.id) // release the claim so it can be retried
        return NextResponse.json({ error: 'Could not credit the wallet. Nothing was changed.' }, { status: 500 })
    }

    await db.from('notifications').insert({
        user_id: payment.user_id,
        title: 'Wallet Topped Up',
        message: `Your wallet has been credited with GHS ${Number(payment.amount).toFixed(2)}`,
        type: 'payment_success',
        action_url: '/dashboard/wallet',
        is_read: false,
    })

    await audit(`Credited GHS ${Number(payment.amount).toFixed(2)} for a paid top-up that was never credited`, {
        outcome: 'credited',
        newBalance: (credited as any).balance,
    })
    return NextResponse.json({ outcome: 'credited', newBalance: (credited as any).balance })
}
