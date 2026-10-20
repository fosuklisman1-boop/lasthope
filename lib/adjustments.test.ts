import { describe, it, expect } from 'vitest'
import { checkAdjustment, parseConfirmAbove, DEFAULT_CONFIRM_ABOVE } from './adjustments'

describe('checkAdjustment', () => {
    it('accepts a normal credit with a reason', () => {
        expect(checkAdjustment({ amount: '25.50', reason: '  Failed top-up refund  ' })).toEqual({
            ok: true,
            amount: 25.5,
            reason: 'Failed top-up refund',
        })
    })

    it.each([0, -5, 'abc', NaN, undefined, 1_000_001])('rejects the amount %s', (amount) => {
        const r = checkAdjustment({ amount, reason: 'valid reason' })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.code).toBe('invalid_amount')
    })

    it('rejects more than two decimal places', () => {
        const r = checkAdjustment({ amount: 10.123, reason: 'valid reason' })
        expect(r).toMatchObject({ ok: false, code: 'invalid_amount' })
    })

    it('accepts two decimals despite floating point noise', () => {
        expect(checkAdjustment({ amount: 0.1 + 0.2, reason: 'valid reason' })).toMatchObject({ ok: true, amount: 0.3 })
        expect(checkAdjustment({ amount: 19.99, reason: 'valid reason' })).toMatchObject({ ok: true, amount: 19.99 })
    })

    it('requires a reason of at least five characters', () => {
        expect(checkAdjustment({ amount: 10, reason: '' })).toMatchObject({ ok: false, code: 'reason_required' })
        expect(checkAdjustment({ amount: 10, reason: '  ab ' })).toMatchObject({ ok: false, code: 'reason_required' })
        expect(checkAdjustment({ amount: 10, reason: undefined })).toMatchObject({ ok: false, code: 'reason_required' })
    })

    it('asks for a second confirmation above the threshold only', () => {
        expect(checkAdjustment({ amount: 500, reason: 'valid reason' })).toMatchObject({ ok: true })
        expect(checkAdjustment({ amount: 500.01, reason: 'valid reason' })).toMatchObject({ ok: false, code: 'needs_confirmation' })
        expect(checkAdjustment({ amount: 800, reason: 'valid reason', confirmLarge: true })).toMatchObject({ ok: true, amount: 800 })
    })

    it('honours a custom threshold', () => {
        expect(checkAdjustment({ amount: 60, reason: 'valid reason', confirmAbove: 50 })).toMatchObject({ ok: false, code: 'needs_confirmation' })
    })

    it('caps the stored reason length', () => {
        const r = checkAdjustment({ amount: 10, reason: 'x'.repeat(900) })
        expect(r.ok && r.reason.length).toBe(300)
    })
})

describe('parseConfirmAbove', () => {
    it('reads a positive number and falls back otherwise', () => {
        expect(parseConfirmAbove('250')).toBe(250)
        expect(parseConfirmAbove('0')).toBe(DEFAULT_CONFIRM_ABOVE)
        expect(parseConfirmAbove('junk')).toBe(DEFAULT_CONFIRM_ABOVE)
        expect(parseConfirmAbove(undefined)).toBe(DEFAULT_CONFIRM_ABOVE)
    })
})
