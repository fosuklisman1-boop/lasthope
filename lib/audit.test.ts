import { describe, it, expect } from 'vitest'
import { buildAuditRow, clientIp, AUDIT_ACTIONS } from './audit'

const actor = { userId: 'u-1', role: 'admin', email: 'boss@example.com' }

describe('buildAuditRow', () => {
    it('maps an entry onto the stored columns', () => {
        const row = buildAuditRow(
            actor,
            {
                action: 'wallet.adjust',
                targetType: 'user',
                targetId: 'u-2',
                summary: 'Credited GHS 50.00',
                details: { amount: 50, type: 'credit' },
                reason: 'Failed top-up compensation',
            },
            '203.0.113.9'
        )
        expect(row).toEqual({
            actor_id: 'u-1',
            actor_email: 'boss@example.com',
            actor_role: 'admin',
            action: 'wallet.adjust',
            target_type: 'user',
            target_id: 'u-2',
            summary: 'Credited GHS 50.00',
            details: { amount: 50, type: 'credit' },
            reason: 'Failed top-up compensation',
            ip: '203.0.113.9',
        })
    })

    it('uses nulls and an empty details object when optional fields are missing', () => {
        const row = buildAuditRow({ userId: 'u-1', role: 'sub-admin' }, { action: 'user.status', summary: 'Suspended a user' })
        expect(row.actor_email).toBeNull()
        expect(row.target_type).toBeNull()
        expect(row.target_id).toBeNull()
        expect(row.reason).toBeNull()
        expect(row.ip).toBeNull()
        expect(row.details).toEqual({})
    })

    it('trims over-long summaries and reasons', () => {
        const row = buildAuditRow(actor, {
            action: 'order.refund',
            summary: 'x'.repeat(1000),
            reason: 'y'.repeat(1000),
        })
        expect(row.summary).toHaveLength(300)
        expect(row.reason).toHaveLength(500)
    })

    it('strips undefined values from details so the row is valid JSON', () => {
        const row = buildAuditRow(actor, {
            action: 'user.role',
            summary: 's',
            details: { from: 'user', to: undefined },
        })
        expect(row.details).toEqual({ from: 'user' })
    })
})

describe('clientIp', () => {
    it('takes the first address in x-forwarded-for', () => {
        const req = new Request('https://x.test', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } })
        expect(clientIp(req)).toBe('203.0.113.9')
    })

    it('returns null when there is no header or no request', () => {
        expect(clientIp(new Request('https://x.test'))).toBeNull()
        expect(clientIp(undefined)).toBeNull()
    })
})

describe('AUDIT_ACTIONS', () => {
    it('has no duplicates', () => {
        expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    })
})
