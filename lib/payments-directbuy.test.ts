import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb } from './__tests__/fake-db'

const h = vi.hoisted(() => ({ sb: null as any, placeOrder: null as any }))

vi.mock('./supabase', () => ({ createServerClient: () => h.sb }))
vi.mock('./email-service', () => ({ sendWalletTopupSuccessEmail: vi.fn(async () => ({})) }))
vi.mock('./sms-service', () => ({
  sendWalletTopupSuccessSMS: vi.fn(async () => ({})),
  sendRoleUpgradeSuccessSMS: vi.fn(async () => ({})),
}))
vi.mock('./orders', async (orig) => ({ ...(await orig<any>()), placeOrder: (...a: any[]) => h.placeOrder(...a) }))

import { processCompletedDirectBuy } from './payments'

function setup(placeOrderImpl: (input: any) => any) {
  let balance = 0
  const db = fakeDb({
    wallet_payments: [{
      id: 'pay1', reference: 'DBY-1', user_id: 'u1', wallet_id: 'w1', amount: 10, fee: 0.2, total_amount: 10.2,
      status: 'pending', metadata: { package_id: 'p1', phone_number: '+233200000000', channel: 'momo_charge' },
    }],
    users: [{ id: 'u1', email: 'a@b.c', first_name: 'A', phone_number: null }],
    orders: [],
  }, (name, args) => {
    if (name === 'credit_wallet') balance += args.p_amount
    return { balance }
  })
  h.sb = db.sb
  h.placeOrder = vi.fn(async (input: any) => placeOrderImpl(input))
  return { ...db, balance: () => balance }
}

const credits = (calls: { name: string; args: any }[]) => calls.filter(c => c.name === 'credit_wallet')

describe('processCompletedDirectBuy', () => {
  beforeEach(() => { h.sb = null; h.placeOrder = null })

  it('credits exactly the package price once, then places the order keyed by the reference', async () => {
    const db = setup(() => ({ ok: true, reference: 'R', orderId: 'o1', price: 10, network: 'MTN', size: '1GB', status: 'pending' }))
    const r = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(r).toMatchObject({ success: true })
    expect(r.orderFailed).toBeFalsy()
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(credits(db.rpcCalls)[0].args).toEqual({ p_wallet_id: 'w1', p_amount: 10 })
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
    expect(h.placeOrder.mock.calls[0][0]).toEqual({
      userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'DBY-1', source: 'direct_buy',
    })
  })

  it('webhook + poll double delivery credits once and reuses the idempotency key', async () => {
    const db = setup(() => ({ ok: true, reference: 'R', orderId: 'o1', price: 10, network: 'MTN', size: '1GB', status: 'pending' }))
    const a = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    const b = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(a.success && b.success).toBe(true)
    expect(b.alreadyProcessed).toBe(true)
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(db.balance()).toBe(10)
    expect(h.placeOrder).toHaveBeenCalledTimes(2)
    expect(h.placeOrder.mock.calls.map((c: any[]) => c[0].idempotencyKey)).toEqual(['DBY-1', 'DBY-1'])
  })

  it('amount mismatch leaves the wallet uncredited and places no order', async () => {
    const db = setup(() => ({ ok: true }))
    const r = await processCompletedDirectBuy('DBY-1', { amount: 1000 }, db.sb)
    expect(r).toMatchObject({ success: false, error: 'Amount mismatch' })
    expect(credits(db.rpcCalls)).toHaveLength(0)
    expect(db.tables.wallet_payments[0].status).toBe('pending')
    expect(h.placeOrder).not.toHaveBeenCalled()
  })

  it('reports orderFailed (money stays in wallet) and heals on a later retry', async () => {
    let ok = false
    const db = setup(() => ok
      ? { ok: true, reference: 'R', orderId: 'o1', price: 10, network: 'MTN', size: '1GB', status: 'pending' }
      : { ok: false, code: 'package_not_found', message: 'gone', httpStatus: 404 })
    const first = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(first).toMatchObject({ success: true, orderFailed: true })
    expect(db.balance()).toBe(10)
    ok = true
    const second = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(second.success).toBe(true)
    expect(second.orderFailed).toBeFalsy()
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(h.placeOrder).toHaveBeenCalledTimes(2)
    expect(h.placeOrder.mock.calls.map((c: any[]) => c[0].idempotencyKey)).toEqual(['DBY-1', 'DBY-1'])
  })

  it('treats a lost concurrent placeOrder race as success when the keyed order exists', async () => {
    const db = setup(() => ({ ok: false, code: 'order_failed', message: 'dup', httpStatus: 500 }))
    db.tables.orders.push({ id: 'o1', user_id: 'u1', idempotency_key: 'DBY-1', status: 'pending' })
    const r = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(r.success).toBe(true)
    expect(r.orderFailed).toBeFalsy()
  })

  it('does not place an order when the payment row is not completed (e.g. marked failed)', async () => {
    const db = setup(() => ({ ok: true }))
    db.tables.wallet_payments[0].status = 'failed'
    const r = await processCompletedDirectBuy('DBY-1', { amount: 1020 }, db.sb)
    expect(r.success).toBe(false)
    expect(credits(db.rpcCalls)).toHaveLength(0)
    expect(h.placeOrder).not.toHaveBeenCalled()
  })
})
