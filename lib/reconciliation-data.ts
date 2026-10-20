import { reconcile, isUpgradePayment, type Issue, type PaymentRow, type CreditRow } from '@/lib/reconciliation'

const PAYMENT_LIMIT = 2000
const CREDIT_LIMIT = 5000

export interface ReconciliationData {
    issues: Issue[]
    checked: number
    truncated: boolean
}

/** Load wallet top-ups and their credits for the last `days` days and compare them. */
export async function loadReconciliation(db: any, days: number): Promise<ReconciliationData> {
    const since = new Date(Date.now() - days * 86400000)
    const creditSince = new Date(since.getTime() - 86400000) // a credit can land a little after its payment

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
    if (paymentsRes.error) throw new Error(paymentsRes.error.message)
    if (creditsRes.error) throw new Error(creditsRes.error.message)

    const payments = (paymentsRes.data ?? []) as PaymentRow[]
    const credits = (creditsRes.data ?? []) as CreditRow[]
    return {
        issues: reconcile(payments, credits),
        checked: payments.filter(p => !isUpgradePayment(p)).length,
        truncated: payments.length >= PAYMENT_LIMIT || credits.length >= CREDIT_LIMIT,
    }
}
