import { describe, it, expect } from 'vitest'
import { placeOrder } from './orders'

function fakeSupabase(opts: { pkg?: any; existing?: any; debitOk?: boolean }) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api, eq: () => api, is: () => api,
        maybeSingle: async () => {
          if (table === 'orders') return { data: opts.existing ?? null, error: null }
          if (table === 'users') return { data: { role: 'user' }, error: null }
          return { data: null, error: null }
        },
        single: async () => {
          if (table === 'data_packages') return { data: opts.pkg ?? null, error: opts.pkg ? null : { code: 'PGRST116' } }
          if (table === 'wallets') return { data: { id: 'w1', balance: 100 }, error: null }
          if (table === 'users') return { data: { role: 'user' }, error: null }
          return { data: null, error: null }
        },
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'o1', reference_code: 'LASTHOPE-X' }, error: null }) }) }),
        update: () => api, delete: () => api,
      }
      return api
    },
    rpc: (_fn: string) => ({ single: async () => (opts.debitOk ? { data: { balance: 90 }, error: null } : { data: null, error: { code: 'PGRST116' } }) }),
  } as any
}

describe('placeOrder', () => {
  it('404s an unknown/unavailable package', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({}))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('package_not_found')
  })
  it('returns insufficient_funds when debit matches no row', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({ pkg: { id: 'p1', price: 10, network: 'MTN', size: '1GB', is_available: true }, debitOk: false }))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('insufficient_funds')
  })
  it('returns the existing order on idempotency hit without charging', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({ existing: { id: 'old', reference_code: 'LASTHOPE-OLD', status: 'pending' } }))
    expect(r.ok).toBe(true); if (r.ok) expect(r.reference).toBe('LASTHOPE-OLD')
  })
  it('rejects invalid phone', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: 'nope', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({}))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('invalid_phone')
  })
})
