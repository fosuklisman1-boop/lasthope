import { describe, it, expect } from 'vitest'
import { reconcile, isUpgradePayment, type PaymentRow, type CreditRow } from './reconciliation'

const NOW = new Date('2026-10-20T12:00:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString()

const pay = (over: Partial<PaymentRow> = {}): PaymentRow => ({
    id: 'p1', reference: 'ref-1', user_id: 'u1', amount: 50, status: 'completed', created_at: ago(300), metadata: {}, ...over,
})
const credit = (over: Partial<CreditRow> = {}): CreditRow => ({
    id: 'c1', reference: 'ref-1', amount: 50, created_at: ago(299), ...over,
})

describe('reconcile', () => {
    it('finds nothing when every completed payment has exactly one matching credit', () => {
        expect(reconcile([pay()], [credit()], NOW)).toEqual([])
    })

    it('flags a completed payment with no credit as fixable', () => {
        const [i] = reconcile([pay()], [], NOW)
        expect(i).toMatchObject({ kind: 'completed_not_credited', severity: 'high', fix: 'credit', paymentId: 'p1' })
    })

    it('flags duplicate credits and amount mismatches, neither auto-fixable', () => {
        const dup = reconcile([pay()], [credit(), credit({ id: 'c2' })], NOW)
        expect(dup[0]).toMatchObject({ kind: 'duplicate_credit', fix: null })
        const diff = reconcile([pay()], [credit({ amount: 45 })], NOW)
        expect(diff[0]).toMatchObject({ kind: 'amount_mismatch', fix: null })
    })

    it('ignores sub-pesewa rounding differences', () => {
        expect(reconcile([pay({ amount: '50.00' })], [credit({ amount: 50.001 })], NOW)).toEqual([])
    })

    it('flags a credit on a payment that is not completed', () => {
        const [i] = reconcile([pay({ status: 'failed' })], [credit()], NOW)
        expect(i.kind).toBe('credit_without_completion')
    })

    it('only flags pending payments once they are old enough, and offers a Paystack check', () => {
        expect(reconcile([pay({ status: 'pending', created_at: ago(30) })], [], NOW)).toEqual([])
        const [i] = reconcile([pay({ status: 'pending', created_at: ago(90) })], [], NOW)
        expect(i).toMatchObject({ kind: 'stuck_pending', severity: 'medium', fix: 'verify' })
    })

    it('does not flag failed payments that have no credit', () => {
        expect(reconcile([pay({ status: 'failed' })], [], NOW)).toEqual([])
    })

    it('skips role-upgrade payments, which never credit a wallet', () => {
        expect(reconcile([pay({ reference: 'upgrade_123', status: 'completed' })], [], NOW)).toEqual([])
        expect(reconcile([pay({ reference: 'agent_upgrade_9' })], [], NOW)).toEqual([])
        expect(reconcile([pay({ metadata: { target_role: 'agent' } })], [], NOW)).toEqual([])
    })

    it('sorts high severity first, then newest', () => {
        const issues = reconcile(
            [
                pay({ id: 'old-high', reference: 'a', created_at: ago(500) }),
                pay({ id: 'stuck', reference: 'b', status: 'pending', created_at: ago(200) }),
                pay({ id: 'new-high', reference: 'c', created_at: ago(400) }),
            ],
            [],
            NOW
        )
        expect(issues.map(i => i.paymentId)).toEqual(['new-high', 'old-high', 'stuck'])
    })
})

describe('isUpgradePayment', () => {
    it('recognises upgrades by reference prefix or target_role', () => {
        expect(isUpgradePayment({ reference: 'upgrade_1', metadata: null })).toBe(true)
        expect(isUpgradePayment({ reference: 'x', metadata: { target_role: 'dealer' } })).toBe(true)
        expect(isUpgradePayment({ reference: 'topup_1', metadata: {} })).toBe(false)
    })
})
