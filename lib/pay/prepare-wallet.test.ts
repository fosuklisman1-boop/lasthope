import { describe, it, expect } from 'vitest'
import { PayError } from './errors'
import { prepareTopup, prepareUpgrade, prepareDirectBuy, markPaymentFailed } from './prepare-wallet'

type Tables = Record<string, { one?: any; list?: any[]; bySlug?: Record<string, any> }>

function fake(tables: Tables) {
  const inserts: any[] = []
  const updates: any[] = []
  const queries: { table: string; filters: [string, any][] }[] = []
  const sb: any = {
    from(table: string) {
      const t = tables[table] ?? {}
      const filters: [string, any][] = []
      queries.push({ table, filters })
      const row = () => {
        if (t.bySlug) { const f = filters.find(x => x[0] === 'slug'); return f ? t.bySlug[f[1]] ?? null : null }
        return t.one ?? null
      }
      const api: any = {
        select: () => api, is: () => api,
        eq: (c: string, v: any) => { filters.push([c, v]); return api },
        in: (c: string, v: any) => { filters.push([c, v]); return api },
        single: async () => ({ data: row(), error: row() ? null : { code: 'PGRST116' } }),
        maybeSingle: async () => ({ data: row(), error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: t.list ?? [], error: null }).then(res, rej),
        insert: (row: any) => {
          inserts.push({ table, row })
          const r: any = { select: () => r, single: async () => ({ data: { id: 'new', ...row }, error: null }), then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }
          return r
        },
        update: (patch: any) => {
          const rec: any = { table, patch, filters: [] as any[] }
          updates.push(rec)
          const u: any = { eq: (c: string, v: any) => { rec.filters.push([c, v]); return u }, then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }
          return u
        },
      }
      return api
    },
  }
  return { sb, inserts, updates, queries }
}

describe('prepareTopup', () => {
  it('rejects amounts under GHS 5', async () => {
    const { sb } = fake({})
    await expect(prepareTopup(sb, { userId: 'u1', email: 'a@b.c', amount: 4 })).rejects.toMatchObject({ httpStatus: 400, message: 'Minimum amount is GHS 5' })
    await expect(prepareTopup(sb, { userId: 'u1', email: 'a@b.c', amount: 4 })).rejects.toBeInstanceOf(PayError)
  })
  it('adds the fee and records the pending row', async () => {
    const { sb, inserts } = fake({
      wallets: { one: { id: 'w1' } },
      users: { one: { role: 'user' } },
      admin_settings: { list: [{ key: 'paystack_fee_percent', value: 2 }] },
    })
    const r = await prepareTopup(sb, { userId: 'u1', email: 'a@b.c', amount: 100 })
    expect(r.totalAmount).toBe(102)
    expect(r.email).toBe('a@b.c')
    expect(r.reference.startsWith('WAL-')).toBe(true)
    const row = inserts.find(i => i.table === 'wallet_payments').row
    expect(row).toMatchObject({ fee: 2, total_amount: 102, amount: 100, provider: 'paystack', status: 'pending', wallet_id: 'w1', reference: r.reference })
    expect(row.metadata.channel).toBe('momo_charge')
  })
})

describe('prepareUpgrade', () => {
  it('rejects an admin user even for an upgradable tier', async () => {
    const { sb, inserts } = fake({
      users: { one: { role: 'admin' } }, wallets: { one: { id: 'w1' } },
      roles: { bySlug: { admin: { slug: 'admin', is_reseller: false }, agent: { slug: 'agent', is_reseller: true, upgradable: true, upgrade_price: 80 } } },
    })
    await expect(prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'agent' })).rejects.toMatchObject({ httpStatus: 400 })
    expect(inserts).toHaveLength(0)
  })
  it('rejects admin as the target tier', async () => {
    const { sb } = fake({
      users: { one: { role: 'user' } }, wallets: { one: { id: 'w1' } },
      roles: { bySlug: { user: { slug: 'user', is_reseller: false }, admin: { slug: 'admin', upgradable: true, upgrade_price: 99 } } },
    })
    await expect(prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'admin' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('rejects a non-upgradable target', async () => {
    // roles fake returns the same row for current and target lookups
    const { sb } = fake({ users: { one: { role: 'user' } }, wallets: { one: { id: 'w1' } },
      roles: { bySlug: { user: { slug: 'user' }, agent: { slug: 'agent', is_reseller: true, upgradable: false, upgrade_price: 50 } } } })
    await expect(prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'agent' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('prepares a valid upgrade at the role price with no fee', async () => {
    const { sb, inserts } = fake({ users: { one: { role: 'user' } }, wallets: { one: { id: 'w1' } },
      roles: { bySlug: { user: { slug: 'user' }, agent: { slug: 'agent', is_reseller: true, upgradable: true, upgrade_price: 80 } } } })
    const r = await prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'agent' })
    expect(r.totalAmount).toBe(80)
    expect(r.reference.startsWith('upgrade_')).toBe(true)
    const row = inserts.find(i => i.table === 'wallet_payments').row
    expect(row).toMatchObject({ fee: 0, amount: 80, total_amount: 80, status: 'pending', provider: 'paystack' })
    expect(row.metadata).toMatchObject({ user_id: 'u1', target_role: 'agent', channel: 'momo_charge' })
  })
})

describe('prepareDirectBuy', () => {
  const pkg = { id: 'p1', price: 10, network: 'MTN', size: '1GB', is_available: true }
  it('404s an unavailable package', async () => {
    const { sb, queries } = fake({ users: { one: { role: 'user' } } })
    await expect(prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: '0200000000' })).rejects.toMatchObject({ httpStatus: 404 })
    const q = queries.find(x => x.table === 'data_packages')!
    expect(q.filters).toEqual(expect.arrayContaining([['id', 'p1'], ['is_available', true]]))
  })
  it('400s a bad phone', async () => {
    const { sb } = fake({ data_packages: { one: pkg }, users: { one: { role: 'user' } } })
    await expect(prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: 'nope' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('prepares a valid purchase', async () => {
    const { sb, inserts, queries } = fake({
      data_packages: { one: pkg }, users: { one: { role: 'user' } }, wallets: { one: { id: 'w1' } },
      admin_settings: { list: [{ key: 'paystack_fee_percent', value: 2 }] },
    })
    const r = await prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: '0200000000' })
    expect(r.reference.startsWith('DBY-')).toBe(true)
    expect(r.totalAmount).toBeCloseTo(10.2, 2)
    const row = inserts.find(i => i.table === 'wallet_payments').row
    expect(queries.find(x => x.table === 'data_packages')!.filters).toEqual(expect.arrayContaining([['is_available', true]]))
    expect(row.user_id).toBe('u1')
    expect(row.amount).toBe(10)
    expect(row.metadata).toMatchObject({ package_id: 'p1', phone_number: '+233200000000', channel: 'momo_charge' })
  })
})

describe('markPaymentFailed', () => {
  it('fails only the pending row for the reference', async () => {
    const { sb, updates } = fake({})
    await markPaymentFailed(sb, 'REF1')
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('wallet_payments')
    expect(updates[0].patch).toMatchObject({ status: 'failed' })
    expect(updates[0].filters).toEqual(expect.arrayContaining([['reference', 'REF1'], ['status', 'pending']]))
  })
})
