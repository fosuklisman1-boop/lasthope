import { describe, it, expect } from 'vitest'
import { initialState, reduce, isTerminal, isPolling, canPay, isDismissible, isCurrentAttempt, POLL_INTERVAL_MS, POLL_TIMEOUT_MS, AMBIGUOUS_MESSAGE } from './momo-machine'

const charging = () => reduce(initialState, { type: 'PAY' })
const waiting = () => reduce(charging(), { type: 'CHARGE_OK', reference: 'R1', state: 'pay_offline' })

describe('momo machine', () => {
  it('constants', () => {
    expect(POLL_INTERVAL_MS).toBe(3000)
    expect(POLL_TIMEOUT_MS).toBe(120000)
  })
  it('PAY from idle -> charging', () => {
    expect(charging().phase).toBe('charging')
  })
  it('double Pay press while charging is ignored', () => {
    const s = charging()
    expect(reduce(s, { type: 'PAY' })).toBe(s)
  })
  it('pay_offline -> waiting', () => {
    const s = waiting()
    expect(s.phase).toBe('pay_offline')
    expect(s.reference).toBe('R1')
    expect(isPolling(s)).toBe(true)
  })
  it('send_otp / send_voucher -> code entry', () => {
    expect(reduce(charging(), { type: 'CHARGE_OK', reference: 'R', state: 'send_otp' }).phase).toBe('send_otp')
    expect(reduce(charging(), { type: 'CHARGE_OK', reference: 'R', state: 'send_voucher' }).phase).toBe('send_voucher')
  })
  it('success -> success, stable on repeat', () => {
    const s = reduce(waiting(), { type: 'SERVER_STATE', state: 'success' })
    expect(s.phase).toBe('success')
    expect(reduce(s, { type: 'SERVER_STATE', state: 'success' })).toBe(s)
    expect(isTerminal(s)).toBe(true)
    expect(isPolling(s)).toBe(false)
  })
  it('failed -> failed with message', () => {
    const s = reduce(waiting(), { type: 'SERVER_STATE', state: 'failed', message: 'Declined' })
    expect(s.phase).toBe('failed')
    expect(s.message).toBe('Declined')
  })
  it('pending keeps current phase', () => {
    const w = waiting()
    expect(reduce(w, { type: 'SERVER_STATE', state: 'pending' })).toBe(w)
  })
  it('pending after charge_ok maps to waiting', () => {
    expect(reduce(charging(), { type: 'CHARGE_OK', reference: 'R', state: 'pending' }).phase).toBe('pay_offline')
  })
  it('paid_order_failed -> orderFailed', () => {
    const s = reduce(waiting(), { type: 'SERVER_STATE', state: 'paid_order_failed' })
    expect(s.phase).toBe('order_failed')
    expect(isTerminal(s)).toBe(true)
  })
  it('ambiguous error with reference -> waiting for that reference', () => {
    const s = reduce(charging(), { type: 'CHARGE_ERROR', message: 'x', reference: 'AMB' })
    expect(s.phase).toBe('pay_offline')
    expect(s.reference).toBe('AMB')
    expect(s.message).toBe(AMBIGUOUS_MESSAGE)
    expect(isPolling(s)).toBe(true)
  })
  it('error without reference -> failed', () => {
    const s = reduce(charging(), { type: 'CHARGE_ERROR', message: 'Bad phone' })
    expect(s.phase).toBe('failed')
    expect(s.message).toBe('Bad phone')
  })
  it('timeout after 120s -> timeout, no new charge', () => {
    const w = waiting()
    expect(reduce(w, { type: 'TICK', elapsedMs: 119000 })).toBe(w)
    const t = reduce(w, { type: 'TICK', elapsedMs: 120000 })
    expect(t.phase).toBe('timeout')
    expect(t.reference).toBe('R1')
    expect(isPolling(t)).toBe(false)
    // PAY press from timeout is the only way to a new attempt
    expect(reduce(t, { type: 'TICK', elapsedMs: 130000 })).toBe(t)
  })
  it('new PAY after failed/timeout creates a fresh attempt (reference dropped)', () => {
    const t = reduce(waiting(), { type: 'TICK', elapsedMs: 120000 })
    const s = reduce(t, { type: 'PAY' })
    expect(s.phase).toBe('charging')
    expect(s.reference).toBeUndefined()
  })
  it('PAY ignored while waiting or on success', () => {
    const w = waiting()
    expect(reduce(w, { type: 'PAY' })).toBe(w)
    const ok = reduce(w, { type: 'SERVER_STATE', state: 'success' })
    expect(reduce(ok, { type: 'PAY' })).toBe(ok)
  })
  it('late server events after terminal are ignored', () => {
    const f = reduce(waiting(), { type: 'SERVER_STATE', state: 'failed' })
    expect(reduce(f, { type: 'SERVER_STATE', state: 'success' })).toBe(f)
  })
  it('otp accepted keeps code entry until server state moves', () => {
    const s = reduce(charging(), { type: 'CHARGE_OK', reference: 'R', state: 'send_otp' })
    expect(reduce(s, { type: 'OTP_RESULT', state: 'pay_offline' }).phase).toBe('pay_offline')
    expect(reduce(s, { type: 'OTP_ERROR', message: 'Wrong code' }).message).toBe('Wrong code')
    expect(reduce(s, { type: 'OTP_ERROR', message: 'Wrong code' }).phase).toBe('send_otp')
  })
  it('RESET returns to idle', () => {
    expect(reduce(waiting(), { type: 'RESET' })).toBe(initialState)
  })

  it('canPay only from idle/failed/timeout', () => {
    for (const p of ['idle', 'failed', 'timeout'] as const) expect(canPay(p)).toBe(true)
    for (const p of ['charging', 'pay_offline', 'send_otp', 'send_voucher', 'success', 'order_failed'] as const) expect(canPay(p)).toBe(false)
  })
  it('isDismissible blocks charging/waiting/code entry', () => {
    for (const p of ['charging', 'pay_offline', 'send_otp', 'send_voucher'] as const) expect(isDismissible(p)).toBe(false)
    for (const p of ['idle', 'success', 'failed', 'timeout', 'order_failed'] as const) expect(isDismissible(p)).toBe(true)
  })
  it('isCurrentAttempt drops stale responses', () => {
    expect(isCurrentAttempt(3, 3)).toBe(true)
    expect(isCurrentAttempt(4, 3)).toBe(false)
  })
})
