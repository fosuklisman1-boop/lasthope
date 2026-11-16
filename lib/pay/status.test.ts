import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeDb } from '../__tests__/fake-db'
import { calculatePaystackFee } from '../utils'

const h = vi.hoisted(() => ({ sb: null as any, placeOrder: null as any }))

vi.mock('../supabase', () => ({ createServerClient: () => h.sb }))
vi.mock('../email-service', () => ({ sendWalletTopupSuccessEmail: vi.fn(async () => ({})) }))
vi.mock('../sms-service', () => ({
  sendWalletTopupSuccessSMS: vi.fn(async () => ({})),
  sendRoleUpgradeSuccessSMS: vi.fn(async () => ({})),
}))
vi.mock('../orders', async (orig) => ({ ...(await orig<any>()), placeOrder: (...a: any[]) => h.placeOrder(...a) }))

import { getPaymentState, purposeFromReference, assertOwner } from './status'
import { PayError } from './errors'

const okOrder = { ok: true, reference: 'R', orderId: 'o1', price: 10, network: 'MTN', size: '1GB', status: 'pending' }

function setup(creditHook?: (args: any) => any) {
  let balance = 0
  const db = fakeDb({
    wallet_payments: [
      { id: 'w-wal', reference: 'WAL-1', user_id: 'u1', wallet_id: 'w1', amount: 100, fee: 2, total_amount: 102, status: 'pending', metadata: { channel: 'momo_charge' } },
      { id: 'w-dby', reference: 'DBY-1', user_id: 'u1', wallet_id: 'w1', amount: 10, fee: 0.2, total_amount: 10.2, status: 'pending', metadata: { package_id: 'p1', phone_number: '+233200000000', channel: 'momo_charge' } },
      { id: 'w-up', reference: 'upgrade_1', user_id: 'u1', wallet_id: 'w1', amount: 80, fee: 0, total_amount: 80, status: 'pending', metadata: { user_id: 'u1', target_role: 'agent', channel: 'momo_charge' } },
    ],
    orders: [
      { id: 'o-gst', reference: 'GST-1', email: 'Guest@Example.com', price: 10, status: 'pending', payment_status: 'unpaid', shop_id: null },
    ],
    users: [{ id: 'u1', role: 'user', email: 'a@b.c', first_name: 'A', phone_number: null }],
    roles: [],
  }, (name, args) => {
    if (name !== 'credit_wallet') return { balance }
    const hook = creditHook ? creditHook(args) : undefined
    if (hook === null) return null // rpc failure: nothing credited
    return Promise.resolve(hook).then(() => { balance += args.p_amount; return { balance } })
  })
  h.sb = db.sb
  h.placeOrder = vi.fn(async () => okOrder)
  return { ...db, balance: () => balance }
}

const verifyWith = (state: string, amountKobo?: number) =>
  vi.fn(async (_ref: string) => ({ state: state as any, amountKobo, data: { status: state, amount: amountKobo } }))
const credits = (calls: { name: string }[]) => calls.filter(c => c.name === 'credit_wallet')
const u1 = { userId: 'u1', email: 'a@b.c' }

describe('purposeFromReference', () => {
  it('maps reference prefixes', () => {
    expect(purposeFromReference('upgrade_abc')).toBe('upgrade')
    expect(purposeFromReference('agent_upgrade_abc')).toBe('upgrade')
    expect(purposeFromReference('DBY-1')).toBe('direct_buy')
    expect(purposeFromReference('GST-1')).toBe('storefront')
    expect(purposeFromReference('WAL-1')).toBe('topup')
  })
  it('treats target_role metadata as an upgrade', () => {
    expect(purposeFromReference('WAL-1', { target_role: 'agent' })).toBe('upgrade')
  })
})

describe('ownership', () => {
  beforeEach(() => { h.sb = null })

  it('404s a WAL- reference owned by another user, without asking Paystack', async () => {
    const db = setup()
    const verify = verifyWith('success', 10200)
    const p = getPaymentState(db.sb, 'WAL-1', { userId: 'u2' }, { verify })
    await expect(p).rejects.toBeInstanceOf(PayError)
    await expect(getPaymentState(db.sb, 'WAL-1', { userId: 'u2' }, { verify })).rejects.toMatchObject({ httpStatus: 404 })
    expect(verify).not.toHaveBeenCalled()
    expect(credits(db.rpcCalls)).toHaveLength(0)
  })

  it('404s a wallet reference when the caller is anonymous', async () => {
    const db = setup()
    await expect(assertOwner(db.sb, 'WAL-1', { email: 'a@b.c' })).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('404s an unknown reference with the same error as an unowned one', async () => {
    const db = setup()
    const unknown = await assertOwner(db.sb, 'WAL-nope', u1).catch(e => e)
    const unowned = await assertOwner(db.sb, 'WAL-1', { userId: 'u2' }).catch(e => e)
    expect(unknown).toBeInstanceOf(PayError)
    expect(unknown.httpStatus).toBe(404)
    expect(unknown.message).toBe(unowned.message)
  })

  it('404s a GST- reference presented with the wrong email', async () => {
    const db = setup()
    await expect(getPaymentState(db.sb, 'GST-1', { email: 'other@example.com' }, { verify: verifyWith('success') }))
      .rejects.toMatchObject({ httpStatus: 404 })
    await expect(assertOwner(db.sb, 'GST-1', { userId: 'u1' })).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('accepts the GST- email case-insensitively', async () => {
    const db = setup()
    await expect(assertOwner(db.sb, 'GST-1', { email: ' guest@example.COM ' })).resolves.toBeUndefined()
  })
})

describe('getPaymentState', () => {
  beforeEach(() => { h.sb = null })

  it('returns non-success states as-is without processing', async () => {
    const db = setup()
    for (const s of ['pay_offline', 'send_otp', 'pending', 'failed']) {
      const r = await getPaymentState(db.sb, 'WAL-1', u1, { verify: verifyWith(s) })
      expect(r.state).toBe(s)
    }
    expect(credits(db.rpcCalls)).toHaveLength(0)
    expect(db.tables.wallet_payments[0].status).toBe('pending')
  })

  it('topup success twice (webhook + poll) credits the wallet once', async () => {
    const db = setup()
    const verify = verifyWith('success', 10200)
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('success')
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('success')
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(db.balance()).toBe(100)
  })

  it('success with an amount different from expected -> failed, wallet not credited', async () => {
    const db = setup()
    const r = await getPaymentState(db.sb, 'WAL-1', u1, { verify: verifyWith('success', 100) })
    expect(r.state).toBe('failed')
    expect(credits(db.rpcCalls)).toHaveLength(0)
    expect(db.tables.wallet_payments[0].status).toBe('pending')
  })

  it('success without a reported amount is not processed', async () => {
    const db = setup()
    const r = await getPaymentState(db.sb, 'WAL-1', u1, { verify: verifyWith('success', undefined) })
    expect(r.state).toBe('pending')
    expect(credits(db.rpcCalls)).toHaveLength(0)
  })

  it('direct buy: order failure -> paid_order_failed with wallet credited, retry heals without re-crediting', async () => {
    const db = setup()
    h.placeOrder = vi.fn(async () => ({ ok: false, code: 'package_not_found', message: 'gone', httpStatus: 404 }))
    const verify = verifyWith('success', 1020)
    const first = await getPaymentState(db.sb, 'DBY-1', u1, { verify })
    expect(first.state).toBe('paid_order_failed')
    expect(first.message).toBeTruthy()
    expect(db.balance()).toBe(10)

    const failingCalls = h.placeOrder.mock.calls
    h.placeOrder = vi.fn(async () => okOrder)
    const second = await getPaymentState(db.sb, 'DBY-1', u1, { verify })
    expect(second.state).toBe('success')
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(db.balance()).toBe(10)
    expect(failingCalls[0][0].idempotencyKey).toBe('DBY-1')
    expect(h.placeOrder.mock.calls[0][0].idempotencyKey).toBe('DBY-1')
  })

  it('direct buy amount mismatch -> failed, nothing credited, no order', async () => {
    const db = setup()
    const r = await getPaymentState(db.sb, 'DBY-1', u1, { verify: verifyWith('success', 1000) })
    expect(r.state).toBe('failed')
    expect(credits(db.rpcCalls)).toHaveLength(0)
    expect(h.placeOrder).not.toHaveBeenCalled()
  })

  it('upgrade success grants the role once', async () => {
    const db = setup()
    const verify = verifyWith('success', 8000)
    expect((await getPaymentState(db.sb, 'upgrade_1', u1, { verify })).state).toBe('success')
    expect(db.tables.users[0].role).toBe('agent')
    expect(db.tables.wallet_payments[2].status).toBe('completed')
    expect(credits(db.rpcCalls)).toHaveLength(0)
  })

  it('guest storefront success marks the order paid; mismatch leaves it unpaid', async () => {
    const db = setup()
    const guest = { email: 'guest@example.com' }
    const bad = await getPaymentState(db.sb, 'GST-1', guest, { verify: verifyWith('success', 1) })
    expect(bad.state).toBe('failed')
    expect(db.tables.orders[0].payment_status).toBe('unpaid')

    const kobo = Math.round((10 + calculatePaystackFee(10, 1.95)) * 100)
    const ok = await getPaymentState(db.sb, 'GST-1', guest, { verify: verifyWith('success', kobo) })
    expect(ok.state).toBe('success')
    expect(db.tables.orders[0]).toMatchObject({ payment_status: 'paid', status: 'pending_download' })
  })

  it('top-up: credit_wallet failure -> pending (not success); the retry credits exactly once', async () => {
    let failCredit = true
    const db = setup(() => (failCredit ? null : undefined))
    const verify = verifyWith('success', 10200)
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('pending')
    expect(db.tables.wallet_payments[0].status).toBe('pending')
    expect(db.balance()).toBe(0)
    // still failing: must not flip to success just because the row was touched before
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('pending')
    expect(db.balance()).toBe(0)

    failCredit = false
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('success')
    expect((await getPaymentState(db.sb, 'WAL-1', u1, { verify })).state).toBe('success')
    expect(db.balance()).toBe(100)
    expect(db.tables.wallet_transactions.filter((t: any) => t.type === 'credit')).toHaveLength(1)
  })

  it('direct buy: credit_wallet failure -> pending; retry credits once and places the order once', async () => {
    let failCredit = true
    const db = setup(() => (failCredit ? null : undefined))
    const verify = verifyWith('success', 1020)
    const first = await getPaymentState(db.sb, 'DBY-1', u1, { verify })
    expect(first.state).toBe('pending')
    expect(db.tables.wallet_payments[1].status).toBe('pending')
    expect(h.placeOrder).not.toHaveBeenCalled()

    failCredit = false
    expect((await getPaymentState(db.sb, 'DBY-1', u1, { verify })).state).toBe('success')
    expect(db.balance()).toBe(10)
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
  })

  it('direct buy: alreadyProcessed with no credit transaction -> pending, no order', async () => {
    const db = setup()
    db.tables.wallet_payments[1].status = 'completed'
    const r = await getPaymentState(db.sb, 'DBY-1', u1, { verify: verifyWith('success', 1020) })
    expect(r.state).toBe('pending')
    expect(h.placeOrder).not.toHaveBeenCalled()
    expect(db.balance()).toBe(0)
  })

  it('direct buy interleaving: poll during the webhook credit -> pending, never paid_order_failed', async () => {
    let release!: () => void
    let entered!: () => void
    const inCredit = new Promise<void>(r => { entered = r })
    const db = setup(() => { entered(); return new Promise<void>(r => { release = r }) })
    // what a real placeOrder would see: insufficient funds until the credit lands
    h.placeOrder = vi.fn(async () => (db.balance() >= 10 ? okOrder : { ok: false, code: 'insufficient_funds', message: 'x', httpStatus: 402 }))
    const verify = verifyWith('success', 1020)

    const webhook = getPaymentState(db.sb, 'DBY-1', u1, { verify })
    await inCredit
    const poll = await getPaymentState(db.sb, 'DBY-1', u1, { verify })
    expect(poll.state).toBe('pending')

    release()
    expect((await webhook).state).toBe('success')
    expect(credits(db.rpcCalls)).toHaveLength(1)
    expect(h.placeOrder).toHaveBeenCalledTimes(1)
  })

  it('verify passes the reference through', async () => {
    const db = setup()
    const verify = verifyWith('pending')
    await getPaymentState(db.sb, 'WAL-1', u1, { verify })
    expect(verify).toHaveBeenCalledWith('WAL-1')
  })
})
