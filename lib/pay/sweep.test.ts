import { describe, it, expect } from 'vitest'
import { PaystackChargeError } from '@/lib/paystack-charge'
import {
  sweepTarget, sweepDecision, classifyVerifyError, mergeSweepMetadata,
  GIVE_UP_AFTER_MS, SWEEP_MIN_AGE_MS, SWEEP_BATCH,
} from './sweep'

const HOUR = 60 * 60 * 1000

describe('sweep constants', () => {
  it('values', () => {
    expect(GIVE_UP_AFTER_MS).toBe(24 * HOUR)
    expect(SWEEP_MIN_AGE_MS).toBe(5 * 60 * 1000)
    expect(SWEEP_BATCH).toBe(20)
  })
})

describe('sweepTarget: completion routed by reference prefix', () => {
  it('DBY- -> direct buy (credit AND order), not a bare wallet credit', () => {
    expect(sweepTarget('DBY-1')).toBe('direct_buy')
  })
  it('upgrade_ / agent_upgrade_ / target_role metadata -> upgrade', () => {
    expect(sweepTarget('upgrade_1')).toBe('upgrade')
    expect(sweepTarget('agent_upgrade_1')).toBe('upgrade')
    expect(sweepTarget('WAL-1', { target_role: 'agent' })).toBe('upgrade')
  })
  it('WAL- -> wallet top-up', () => {
    expect(sweepTarget('WAL-1')).toBe('topup')
  })
  it('GST- -> storefront order', () => {
    expect(sweepTarget('GST-1')).toBe('storefront')
  })
})

describe('sweepDecision', () => {
  const young = 10 * 60 * 1000
  const old = GIVE_UP_AFTER_MS
  it('success with amount -> complete (any age)', () => {
    expect(sweepDecision({ kind: 'status', status: 'success', amountKobo: 100 }, young)).toBe('complete')
  })
  it('success without amount -> leave (never complete without the paid amount)', () => {
    expect(sweepDecision({ kind: 'status', status: 'success' }, old)).toBe('leave')
  })
  it('explicit Paystack failed -> mark_failed', () => {
    expect(sweepDecision({ kind: 'status', status: 'failed' }, young)).toBe('mark_failed')
  })
  it('reference not found: leave while young, give up only after GIVE_UP_AFTER_MS', () => {
    expect(sweepDecision({ kind: 'not_found' }, young)).toBe('leave')
    expect(sweepDecision({ kind: 'not_found' }, GIVE_UP_AFTER_MS - 1)).toBe('leave')
    expect(sweepDecision({ kind: 'not_found' }, old)).toBe('mark_failed')
  })
  it('abandoned: leave while young (a MoMo approval can still land), give up when old', () => {
    expect(sweepDecision({ kind: 'status', status: 'abandoned' }, young)).toBe('leave')
    expect(sweepDecision({ kind: 'status', status: 'abandoned' }, old)).toBe('mark_failed')
  })
  it('pending / ongoing / unknown statuses and provider errors never mark failed', () => {
    for (const status of ['pending', 'ongoing', 'send_otp', 'pay_offline', 'reversed', undefined]) {
      expect(sweepDecision({ kind: 'status', status }, old)).toBe('leave')
    }
    expect(sweepDecision({ kind: 'error' }, old)).toBe('leave')
  })
})

describe('classifyVerifyError', () => {
  it('definitive "not found" rejection -> not_found', () => {
    expect(classifyVerifyError(new PaystackChargeError('Transaction reference not found', true))).toEqual({ kind: 'not_found' })
  })
  it('timeouts, network errors, other rejections -> error', () => {
    expect(classifyVerifyError(new PaystackChargeError('Payment provider timed out'))).toEqual({ kind: 'error' })
    expect(classifyVerifyError(new PaystackChargeError('not found', false))).toEqual({ kind: 'error' })
    expect(classifyVerifyError(new PaystackChargeError('Invalid key', true))).toEqual({ kind: 'error' })
    expect(classifyVerifyError(new Error('boom'))).toEqual({ kind: 'error' })
  })
})

describe('mergeSweepMetadata', () => {
  const now = new Date('2026-11-16T00:00:00Z')
  it('keeps existing keys (package_id, target_role) and adds only a sweep note', () => {
    const merged = mergeSweepMetadata({ package_id: 'p1', target_role: 'agent', phone_number: '+233200000000' }, 'abandoned', 'mark_failed', now)
    expect(merged).toEqual({
      package_id: 'p1', target_role: 'agent', phone_number: '+233200000000',
      sweep: { paystack_status: 'abandoned', result: 'mark_failed', checked_at: '2026-11-16T00:00:00.000Z' },
    })
  })
  it('never stores provider customer data', () => {
    const merged = mergeSweepMetadata(null, 'failed', 'mark_failed', now)
    expect(Object.keys(merged)).toEqual(['sweep'])
    expect(Object.keys(merged.sweep).sort()).toEqual(['checked_at', 'paystack_status', 'result'])
  })
  it('tolerates non-object metadata', () => {
    expect(mergeSweepMetadata('x' as any, undefined, 'leave', now)).toEqual({
      sweep: { paystack_status: null, result: 'leave', checked_at: '2026-11-16T00:00:00.000Z' },
    })
  })
})
