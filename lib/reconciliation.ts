export interface PaymentRow {
    id: string
    reference: string
    user_id: string | null
    amount: number | string
    status: string | null
    created_at: string
    metadata?: Record<string, any> | null
}

export interface CreditRow {
    id: string
    reference: string | null
    amount: number | string
    created_at: string
}

export type IssueKind =
    | 'completed_not_credited'
    | 'duplicate_credit'
    | 'amount_mismatch'
    | 'credit_without_completion'
    | 'stuck_pending'

export interface Issue {
    kind: IssueKind
    severity: 'high' | 'medium'
    paymentId: string
    reference: string
    userId: string | null
    amount: number
    createdAt: string
    detail: string
    /** What an admin can do about it from the screen, if anything. */
    fix: 'credit' | 'verify' | null
}

export const KIND_LABEL: Record<IssueKind, string> = {
    completed_not_credited: 'Paid, wallet not credited',
    duplicate_credit: 'Credited more than once',
    amount_mismatch: 'Credited a different amount',
    credit_without_completion: 'Credited, payment not completed',
    stuck_pending: 'Stuck pending',
}

/** Role-upgrade payments live in the same table but never credit a wallet. */
export function isUpgradePayment(p: Pick<PaymentRow, 'reference' | 'metadata'>): boolean {
    return !!p.metadata?.target_role || p.reference.startsWith('upgrade_') || p.reference.startsWith('agent_upgrade_')
}

const money = (n: number) => n.toFixed(2)

/**
 * Compare wallet top-up payments with the wallet credits recorded for them.
 * Pure: pass in the rows and the current time.
 */
export function reconcile(
    payments: PaymentRow[],
    credits: CreditRow[],
    now: Date = new Date(),
    pendingAfterMinutes = 60
): Issue[] {
    const byRef = new Map<string, CreditRow[]>()
    for (const c of credits) {
        if (!c.reference) continue
        const list = byRef.get(c.reference) ?? []
        list.push(c)
        byRef.set(c.reference, list)
    }

    const issues: Issue[] = []
    for (const p of payments) {
        if (isUpgradePayment(p)) continue
        const amount = Number(p.amount)
        const matched = byRef.get(p.reference) ?? []
        const base = { paymentId: p.id, reference: p.reference, userId: p.user_id, amount, createdAt: p.created_at }

        if (p.status === 'completed') {
            if (matched.length === 0) {
                issues.push({
                    ...base, kind: 'completed_not_credited', severity: 'high', fix: 'credit',
                    detail: `Payment of GHS ${money(amount)} is completed but no wallet credit was recorded.`,
                })
            } else if (matched.length > 1) {
                issues.push({
                    ...base, kind: 'duplicate_credit', severity: 'high', fix: null,
                    detail: `${matched.length} credits recorded for one payment of GHS ${money(amount)}. Check the wallet balance.`,
                })
            } else if (Math.abs(Number(matched[0].amount) - amount) > 0.005) {
                issues.push({
                    ...base, kind: 'amount_mismatch', severity: 'high', fix: null,
                    detail: `Payment was GHS ${money(amount)} but the credit was GHS ${money(Number(matched[0].amount))}.`,
                })
            }
            continue
        }

        if (matched.length > 0) {
            issues.push({
                ...base, kind: 'credit_without_completion', severity: 'high', fix: null,
                detail: `The payment is marked ${p.status ?? 'unknown'} but a credit of GHS ${money(Number(matched[0].amount))} exists.`,
            })
            continue
        }

        if (p.status === 'pending') {
            const ageMin = (now.getTime() - new Date(p.created_at).getTime()) / 60000
            if (ageMin > pendingAfterMinutes) {
                issues.push({
                    ...base, kind: 'stuck_pending', severity: 'medium', fix: 'verify',
                    detail: `Pending for ${ageMin >= 120 ? Math.round(ageMin / 60) + ' hours' : Math.round(ageMin) + ' minutes'}. Ask Paystack what happened.`,
                })
            }
        }
    }

    // Worst first, then newest.
    return issues.sort((a, b) =>
        (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
}
