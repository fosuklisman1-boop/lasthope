import { describe, it, expect } from 'vitest'
import { PayError } from './errors'
import { prepareTopup, prepareUpgrade, prepareDirectBuy, markPaymentFailed } from './prepare-wallet'

type Tables = Record<string, { one?: any; list?: any[] }>

function fake(tables: Tables) {
  const inserts: any[] = []
  const updates: any[] = []
  const sb: any = {
    from(table: string) {
      const t = tables[table] ?? {}
      const api: any = {
        select: () => api, eq: () => api, in: () => api, is: () => api,
        single: async () => ({ data: t.one ?? null, error: t.one ? null : { code: 'PGRST116' } }),
        maybeSingle: async () => ({ data: t.one ?? null, error: null }),
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
  return { sb, inserts, updates }
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
  const base = (userRole: any, target: any, extra: Tables = {}) => ({
    users: { one: { role: userRole } },
    wallets: { one: { id: 'w1' } },
    roles: { one: target },
    ...extra,
  })
  it('rejects admins', async () => {
    const { sb } = fake({ users: { one: { role: 'admin' } }, wallets: { one: { id: 'w1' } }, roles: { one: undefined } })
    await expect(prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'agent' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('rejects a non-upgradable target', async () => {
    // roles fake returns the same row for current and target lookups
    const { sb } = fake(base('user', { slug: 'user', is_reseller: false, upgradable: false, upgrade_price: 50 }))
    await expect(prepareUpgrade(sb, { userId: 'u1', email: 'a@b.c', tier: 'agent' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('prepares a valid upgrade at the role price with no fee', async () => {
    const { sb, inserts } = fake(base('user', { slug: 'agent', is_reseller: true, upgradable: true, upgrade_price: 80 }))
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
    const { sb } = fake({ users: { one: { role: 'user' } } })
    await expect(prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: '0200000000' })).rejects.toMatchObject({ httpStatus: 404 })
  })
  it('400s a bad phone', async () => {
    const { sb } = fake({ data_packages: { one: pkg }, users: { one: { role: 'user' } } })
    await expect(prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: 'nope' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('prepares a valid purchase', async () => {
    const { sb, inserts } = fake({
      data_packages: { one: pkg }, users: { one: { role: 'user' } }, wallets: { one: { id: 'w1' } },
      admin_settings: { list: [{ key: 'paystack_fee_percent', value: 2 }] },
    })
    const r = await prepareDirectBuy(sb, { userId: 'u1', email: 'a@b.c', packageId: 'p1', phoneNumber: '0200000000' })
    expect(r.reference.startsWith('DBY-')).toBe(true)
    expect(r.totalAmount).toBeCloseTo(10.2, 2)
    const row = inserts.find(i => i.table === 'wallet_payments').row
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
