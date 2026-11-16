import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb } from './__tests__/fake-db'

const h = vi.hoisted(() => ({ sb: null as any }))

vi.mock('./supabase', () => ({ createServerClient: () => h.sb }))
vi.mock('./email-service', () => ({ sendWalletTopupSuccessEmail: vi.fn(async () => ({})) }))
vi.mock('./sms-service', () => ({
  sendWalletTopupSuccessSMS: vi.fn(async () => ({})),
  sendRoleUpgradeSuccessSMS: vi.fn(async () => ({})),
}))

import { processCompletedUpgradePayment } from './payments'
import { getPaymentState } from './pay/status'

function setup() {
  let failUserUpdate = true
  let roleUpdates = 0
  const db = fakeDb({
    wallet_payments: [{
      id: 'pay1', reference: 'upgrade_1', user_id: 'u1', wallet_id: 'w1', amount: 50, fee: 1, total_amount: 51,
      status: 'pending', metadata: { target_role: 'agent', channel: 'momo_charge' },
    }],
    users: [{ id: 'u1', role: 'user', status: 'active', email: 'a@b.c', first_name: 'A', phone_number: null }],
  }, undefined, (table, patch) => {
    if (table !== 'users' || !('role' in patch)) return null
    if (failUserUpdate) return { code: 'XX000', message: 'users update failed' }
    roleUpdates++
    return null
  })
  h.sb = db.sb
  return { ...db, heal: () => { failUserUpdate = false }, roleUpdates: () => roleUpdates }
}

const verifyOk = async () => ({ state: 'success' as const, amountKobo: 5100, data: {} })

describe('processCompletedUpgradePayment: flag-before-effect', () => {
  beforeEach(() => { h.sb = null })

  it('users update failure reverts the row to pending and reports failure', async () => {
    const db = setup()
    const r = await processCompletedUpgradePayment('upgrade_1', { amount: 5100 })
    expect(r).toMatchObject({ success: false, error: 'Failed to update user role' })
    expect(db.tables.wallet_payments[0].status).toBe('pending')
    expect(db.tables.users[0].role).toBe('user')
  })

  it('/status never reports success while the role is ungranted; a later retry grants it once', async () => {
    const db = setup()
    const caller = { userId: 'u1' }
    expect((await getPaymentState(db.sb, 'upgrade_1', caller, { verify: verifyOk })).state).toBe('pending')
    // Second poll: before the fix the row stayed 'completed' -> alreadyProcessed -> 'success'.
    expect((await getPaymentState(db.sb, 'upgrade_1', caller, { verify: verifyOk })).state).toBe('pending')
    expect(db.tables.users[0].role).toBe('user')

    db.heal()
    expect((await getPaymentState(db.sb, 'upgrade_1', caller, { verify: verifyOk })).state).toBe('success')
    expect(db.tables.users[0].role).toBe('agent')
    expect(db.tables.wallet_payments[0].status).toBe('completed')
    expect((await getPaymentState(db.sb, 'upgrade_1', caller, { verify: verifyOk })).state).toBe('success')
    expect(db.roleUpdates()).toBe(1)
  })

  it('happy path grants the role once and completes the row', async () => {
    const db = setup()
    db.heal()
    expect(await processCompletedUpgradePayment('upgrade_1', { amount: 5100 })).toEqual({ success: true })
    expect(await processCompletedUpgradePayment('upgrade_1', { amount: 5100 })).toMatchObject({ success: true, alreadyProcessed: true })
    expect(db.roleUpdates()).toBe(1)
  })
})
