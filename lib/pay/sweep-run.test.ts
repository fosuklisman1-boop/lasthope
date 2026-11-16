import { describe, it, expect, vi } from 'vitest'
import { PaystackChargeError } from '@/lib/paystack-charge'
import { runSweep, SWEEP_TIME_BUDGET_MS } from './sweep-run'
import { GIVE_UP_AFTER_MS, SWEEP_BATCH } from './sweep'

const NOW = Date.parse('2026-11-16T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 3600_000

function fakeSb(tables: Record<string, any[]>) {
  const reads: { table: string; ops: [string, ...any[]][] }[] = []
  const updates: { table: string; patch: any; filters: [string, any][] }[] = []
  const sb: any = {
    from(table: string) {
      const ops: [string, ...any[]][] = []
      const api: any = {
        select: (...a: any[]) => { ops.push(['select', ...a]); return api },
        eq: (...a: any[]) => { ops.push(['eq', ...a]); return api },
        lt: (...a: any[]) => { ops.push(['lt', ...a]); return api },
        like: (...a: any[]) => { ops.push(['like', ...a]); return api },
        order: (...a: any[]) => { ops.push(['order', ...a]); return api },
        limit: (...a: any[]) => { ops.push(['limit', ...a]); reads.push({ table, ops }); return Promise.resolve({ data: tables[table] ?? [], error: null }) },
        update: (patch: any) => {
          const rec = { table, patch, filters: [] as [string, any][] }
          updates.push(rec)
          const u: any = { eq: (c: string, v: any) => { rec.filters.push([c, v]); return u }, then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }
          return u
        },
      }
      return api
    },
  }
  return { sb, reads, updates }
}

function deps(verify: (ref: string) => any) {
  const ok = async (..._args: any[]): Promise<{ success: boolean; error?: string; pending?: boolean }> => ({ success: true })
  const complete = { topup: vi.fn(ok), upgrade: vi.fn(ok), direct_buy: vi.fn(ok), storefront: vi.fn(ok) }
  return { verify: vi.fn(async (ref: string) => verify(ref)) as any, complete, now: () => NOW }
}

const success = (amount: number) => ({ state: 'success', amountKobo: amount, data: { status: 'success', amount, customer: { email: 'x@y.z', phone: '+233200000000' } } })

describe('runSweep', () => {
  it('reads both tables pending-only, older than 5 min, oldest-checked first, batched', async () => {
    const { sb, reads } = fakeSb({})
    await runSweep(sb, deps(() => success(1)))
    const wp = reads.find(r => r.table === 'wallet_payments')!.ops
    expect(wp).toContainEqual(['eq', 'status', 'pending'])
    expect(wp).toContainEqual(['lt', 'created_at', ago(5 * 60 * 1000)])
    expect(wp).toContainEqual(['order', 'updated_at', { ascending: true }])
    expect(wp).toContainEqual(['limit', SWEEP_BATCH])
    const o = reads.find(r => r.table === 'orders')!.ops
    expect(o).toContainEqual(['eq', 'status', 'pending'])
    expect(o).toContainEqual(['eq', 'payment_status', 'unpaid'])
    expect(o).toContainEqual(['like', 'reference', 'GST-%'])
    expect(o).toContainEqual(['order', 'updated_at', { ascending: true }])
  })

  it('routes each paid reference to its own completion (DBY -> direct buy, not a bare credit)', async () => {
    const { sb } = fakeSb({
      wallet_payments: [
        { id: 'a', reference: 'DBY-1', metadata: { package_id: 'p' }, created_at: ago(HOUR) },
        { id: 'b', reference: 'upgrade_1', metadata: {}, created_at: ago(HOUR) },
        { id: 'c', reference: 'WAL-1', metadata: {}, created_at: ago(HOUR) },
        { id: 'd', reference: 'WAL-2', metadata: { target_role: 'agent' }, created_at: ago(HOUR) },
      ],
      orders: [{ id: 'o', reference: 'GST-1', payment_metadata: {}, created_at: ago(HOUR) }],
    })
    const d = deps(() => success(1020))
    const sum = await runSweep(sb, d)
    expect(d.complete.direct_buy).toHaveBeenCalledWith('DBY-1', expect.objectContaining({ amount: 1020 }), sb)
    expect(d.complete.upgrade.mock.calls.map(c => c[0])).toEqual(['upgrade_1', 'WAL-2'])
    expect(d.complete.topup.mock.calls.map(c => c[0])).toEqual(['WAL-1'])
    expect(d.complete.storefront.mock.calls.map(c => c[0])).toEqual(['GST-1'])
    expect(sum).toMatchObject({ processed: 5, completed: 5, failed: 0 })
  })

  it('reference not found: left pending while young, failed after GIVE_UP_AFTER_MS, metadata merged without customer data', async () => {
    const { sb, updates } = fakeSb({
      wallet_payments: [
        { id: 'young', reference: 'DBY-Y', metadata: { package_id: 'p1', phone_number: '+233' }, created_at: ago(HOUR) },
        { id: 'old', reference: 'DBY-O', metadata: { package_id: 'p2', target_role: 'x' }, created_at: ago(GIVE_UP_AFTER_MS + HOUR) },
      ],
      orders: [{ id: 'og', reference: 'GST-O', payment_metadata: { a: 1 }, created_at: ago(GIVE_UP_AFTER_MS + HOUR) }],
    })
    const d = deps(() => { throw new PaystackChargeError('Transaction reference not found', true) })
    const sum = await runSweep(sb, d)
    expect(sum).toMatchObject({ failed: 2, left: 1, completed: 0 })

    const young = updates.find(u => u.filters.some(f => f[1] === 'young'))!
    expect(young.patch.status).toBeUndefined()
    expect(young.patch.metadata).toMatchObject({ package_id: 'p1', phone_number: '+233', sweep: { paystack_status: 'not_found', result: 'leave' } })

    const old = updates.find(u => u.filters.some(f => f[1] === 'old'))!
    expect(old.patch.status).toBe('failed')
    expect(old.patch.metadata).toMatchObject({ package_id: 'p2', target_role: 'x', sweep: { result: 'mark_failed' } })
    expect(old.filters).toEqual([['id', 'old'], ['status', 'pending']])

    const order = updates.find(u => u.table === 'orders')!
    expect(order.patch).toMatchObject({ payment_status: 'failed', payment_metadata: { a: 1, sweep: { result: 'mark_failed' } } })
    expect(order.patch.status).toBeUndefined()
    for (const c of Object.values(d.complete)) expect(c).not.toHaveBeenCalled()
  })

  it('explicit Paystack failure: failed without copying Paystack data into metadata', async () => {
    const { sb, updates } = fakeSb({ wallet_payments: [{ id: 'f', reference: 'WAL-F', metadata: { k: 1 }, created_at: ago(HOUR) }] })
    await runSweep(sb, deps(() => ({ state: 'failed', data: { status: 'failed', customer: { email: 'x@y.z' } } })))
    expect(updates[0].patch).toMatchObject({ status: 'failed' })
    expect(JSON.stringify(updates[0].patch)).not.toContain('x@y.z')
    expect(updates[0].patch.metadata.k).toBe(1)
  })

  it('timeouts and failed completions leave the row pending (no mark_failed), even when old', async () => {
    const { sb, updates } = fakeSb({
      wallet_payments: [
        { id: 't', reference: 'WAL-T', metadata: {}, created_at: ago(GIVE_UP_AFTER_MS * 2) },
        { id: 'c', reference: 'WAL-C', metadata: {}, created_at: ago(GIVE_UP_AFTER_MS * 2) },
      ],
    })
    const d = deps((ref) => { if (ref === 'WAL-T') throw new PaystackChargeError('Payment provider timed out'); return success(1) })
    d.complete.topup.mockImplementation(async () => ({ success: false, error: 'Failed to credit wallet' }) as any)
    const sum = await runSweep(sb, d)
    expect(sum).toMatchObject({ failed: 0, left: 2 })
    expect(updates.every(u => u.patch.status === undefined)).toBe(true)
  })

  it('a DBY completion that reports pending is not counted as completed', async () => {
    const { sb } = fakeSb({ wallet_payments: [{ id: 'p', reference: 'DBY-P', metadata: {}, created_at: ago(HOUR) }] })
    const d = deps(() => success(1))
    d.complete.direct_buy.mockImplementation(async () => ({ success: true, pending: true }) as any)
    expect(await runSweep(sb, d)).toMatchObject({ completed: 0, left: 1, failed: 0 })
  })

  it('stops starting rows once the time budget is spent', async () => {
    const { sb } = fakeSb({ wallet_payments: [
      { id: '1', reference: 'WAL-1', metadata: {}, created_at: ago(HOUR) },
      { id: '2', reference: 'WAL-2', metadata: {}, created_at: ago(HOUR) },
    ] })
    let t = NOW
    const d = { ...deps(() => { t += SWEEP_TIME_BUDGET_MS + 1; return success(1) }), now: () => t }
    const sum = await runSweep(sb, d)
    expect(sum).toMatchObject({ processed: 1, skipped: 1 })
  })
})
