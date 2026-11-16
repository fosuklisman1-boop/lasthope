import { describe, it, expect } from 'vitest'
import { PayError } from './errors'
import { prepareStorefront, markOrderFailed } from './prepare-storefront'

type Tables = Record<string, { one?: any; list?: any[]; error?: any }>

function fake(tables: Tables) {
  const inserts: any[] = []
  const updates: any[] = []
  const queries: { table: string; filters: [string, any][] }[] = []
  const sb: any = {
    from(table: string) {
      const t = tables[table] ?? {}
      const filters: [string, any][] = []
      queries.push({ table, filters })
      const row = () => t.one ?? null
      const api: any = {
        select: () => api,
        eq: (c: string, v: any) => { filters.push([c, v]); return api },
        in: (c: string, v: any) => { filters.push([c, v]); return api },
        single: async () => ({ data: row(), error: t.error ?? (row() ? null : { code: 'PGRST116' }) }),
        maybeSingle: async () => ({ data: t.error ? null : row(), error: t.error ?? null }),
        then: (res: any, rej: any) => Promise.resolve({ data: t.list ?? [], error: t.error ?? null }).then(res, rej),
        insert: (r: any) => {
          inserts.push({ table, row: r })
          const x: any = { select: () => x, single: async () => ({ data: { id: 'new', ...r }, error: null }), then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }
          return x
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

const pkg = { id: 'p1', price: 10, network: 'MTN', size: '1GB', is_available: true }
const input = { packageId: 'p1', phoneNumber: '0200000000', email: 'a@b.c', shopId: 's1' }
const shopTables = (over: Tables = {}): Tables => ({
  data_packages: { one: pkg },
  shops: { one: { id: 's1', user_id: 'owner1', name: 'Shop' } },
  users: { one: { role: 'user' } },
  roles: { one: { price_table_id: 't1' } },
  price_table_items: { list: [{ package_id: 'p1', price: 8 }] },
  shop_packages: { one: { custom_price: 10 } },
  ...over,
})

describe('prepareStorefront', () => {
  it('400s a missing email', async () => {
    const { sb, inserts } = fake(shopTables())
    await expect(prepareStorefront(sb, { ...input, email: '' })).rejects.toMatchObject({ httpStatus: 400 })
    await expect(prepareStorefront(sb, { ...input, email: '' })).rejects.toBeInstanceOf(PayError)
    expect(inserts).toHaveLength(0)
  })
  it('400s a bad phone', async () => {
    const { sb } = fake(shopTables())
    await expect(prepareStorefront(sb, { ...input, phoneNumber: 'nope' })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('404s an unavailable package, filtering on is_available', async () => {
    const { sb, queries } = fake({})
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 404 })
    expect(queries.find(q => q.table === 'data_packages')!.filters).toEqual(expect.arrayContaining([['id', 'p1'], ['is_available', true]]))
  })
  it('403s a suspended shop with its message and inserts nothing', async () => {
    const { sb, inserts } = fake(shopTables({ shop_controls: { one: { suspended: true, suspended_message: 'Closed for stock' } } }))
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 403, message: 'Closed for stock' })
    expect(inserts).toHaveLength(0)
  })
  it('400s a package blocked for the shop', async () => {
    const { sb, inserts, queries } = fake(shopTables({ shop_blocked_packages: { list: [{ package_id: 'p1' }] } }))
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 400 })
    expect(queries.find(q => q.table === 'shop_blocked_packages')!.filters).toEqual([['shop_id', 's1']])
    expect(inserts).toHaveLength(0)
  })
  it('503s when shop controls cannot be read', async () => {
    const { sb, inserts } = fake(shopTables({ shop_controls: { error: { message: 'down' } } }))
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 503 })
    expect(inserts).toHaveLength(0)
  })
  it('503s when pricing throws, with no fallback to the base price and no order row', async () => {
    const { sb, inserts } = fake(shopTables({ roles: { error: { message: 'down' } } }))
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 503 })
    expect(inserts).toHaveLength(0)
  })
  it('404s an unknown shop', async () => {
    const { sb, inserts } = fake(shopTables({ shops: {} }))
    await expect(prepareStorefront(sb, input)).rejects.toMatchObject({ httpStatus: 404 })
    expect(inserts).toHaveLength(0)
  })
  it('prepares a shop sale: fee on top, profit over the owner cost', async () => {
    const { sb, inserts, queries } = fake(shopTables())
    const r = await prepareStorefront(sb, input)
    expect(r.totalAmount).toBe(10.2)
    expect(r.email).toBe('a@b.c')
    expect(r.reference.startsWith('GST-')).toBe(true)
    const row = inserts.find(i => i.table === 'orders').row
    expect(row).toMatchObject({
      user_id: null, package_id: 'p1', shop_id: 's1', profit_amount: 2, price: 10, amount: 10,
      status: 'pending', payment_status: 'unpaid', fulfillment_method: 'auto',
      reference: r.reference, reference_code: r.reference, email: 'a@b.c',
      phone_number: '+233200000000', customer_phone: '+233200000000', network: 'MTN', size: '1GB',
    })
    expect(queries.find(q => q.table === 'shop_packages')!.filters).toEqual(expect.arrayContaining([['shop_id', 's1'], ['package_id', 'p1']]))
    expect(queries.find(q => q.table === 'customer_prices')!.filters).toEqual([['user_id', 'owner1']])
  })
  it('charges the base package price with no shopId', async () => {
    const { sb, inserts, queries } = fake({ data_packages: { one: pkg } })
    const r = await prepareStorefront(sb, { packageId: 'p1', phoneNumber: '0200000000', email: 'a@b.c' })
    expect(r.totalAmount).toBe(10.2)
    expect(queries.some(q => q.table === 'shops')).toBe(false)
    expect(inserts.find(i => i.table === 'orders').row).toMatchObject({ shop_id: null, profit_amount: 0, price: 10 })
  })
})

describe('markOrderFailed', () => {
  it('fails only the pending order for the reference', async () => {
    const { sb, updates } = fake({})
    await markOrderFailed(sb, 'GST-1')
    expect(updates).toHaveLength(1)
    expect(updates[0].table).toBe('orders')
    expect(updates[0].patch).toEqual({ payment_status: 'failed' })
    expect(updates[0].filters).toEqual(expect.arrayContaining([['reference', 'GST-1'], ['status', 'pending']]))
  })
})
