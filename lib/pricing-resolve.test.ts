import { describe, it, expect } from 'vitest'
import { getPriceForRole, resolvePrice, resolvePriceDetail, emptyPricingContext, type PricingContext } from './pricing'
import { loadPricingContext } from './pricing-context'

const pkg = { id: 'p1', price: 10, agent_price: 9, super_agent_price: 8, premium_agent_price: 7, dealer_price: 6 }

const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({ ...emptyPricingContext('user'), ...over })

describe('resolvePrice: no tables and no overrides behaves exactly like today', () => {
  const roles = ['admin', 'sub-admin', 'user', 'agent', 'super-agent', 'premium-agent', 'dealer', 'customer', 'unknown-role', null, undefined]
  const packages = [
    pkg,
    { id: 'p2', price: 10 },
    { id: 'p3', price: '12.50', agent_price: '11', dealer_price: 0 },
    { id: 'p4', price: 5, agent_price: null, super_agent_price: 0, premium_agent_price: undefined, dealer_price: 4 },
    { id: 'p5', price: 0, agent_price: 3 },
  ]

  it.each(roles)('matches getPriceForRole for role %s on every package', (role) => {
    for (const p of packages) {
      expect(resolvePrice(p as any, emptyPricingContext(role as any))).toBe(getPriceForRole(p as any, role as any))
    }
  })
})

describe('resolvePrice: precedence', () => {
  it("uses the customer's own price over everything", () => {
    const c = ctx({ role: 'agent', tableId: 't1', tableItems: new Map([['p1', 7.5]]), overrides: new Map([['p1', 5]]) })
    expect(resolvePriceDetail(pkg, c)).toEqual({ price: 5, source: 'customer' })
  })

  it("uses the role's price table when there is no customer price", () => {
    const c = ctx({ role: 'vip', tableId: 't1', tableItems: new Map([['p1', 7.5]]) })
    expect(resolvePriceDetail(pkg, c)).toEqual({ price: 7.5, source: 'table' })
  })

  it('charges the base price for a package missing from the role table (not a stale tier column)', () => {
    const c = ctx({ role: 'agent', tableId: 't1', tableItems: new Map([['other', 1]]) })
    expect(resolvePriceDetail(pkg, c)).toEqual({ price: 10, source: 'base' })
  })

  it('uses the legacy tier column only when the role has no price table', () => {
    expect(resolvePriceDetail(pkg, ctx({ role: 'dealer' }))).toEqual({ price: 6, source: 'tier' })
    expect(resolvePriceDetail(pkg, ctx({ role: 'user' }))).toEqual({ price: 10, source: 'base' })
  })

  it('falls back to the table or base when a customer price is missing for that package only', () => {
    const c = ctx({ role: 'vip', tableId: 't1', tableItems: new Map([['p1', 7]]), overrides: new Map([['p2', 1]]) })
    expect(resolvePrice(pkg, c)).toBe(7)
  })

  it('ignores zero or negative stored prices', () => {
    const c = ctx({ role: 'vip', tableId: 't1', tableItems: new Map([['p1', 0]]), overrides: new Map([['p1', -3]]) })
    expect(resolvePrice(pkg, c)).toBe(10)
  })

  it('cannot match overrides for a package without an id', () => {
    expect(resolvePrice({ price: 10 }, ctx({ overrides: new Map([['p1', 1]]) }))).toBe(10)
  })
})

function fakeDb(data: Record<string, { data?: any; error?: any }>, calls: string[] = []) {
  return {
    from(table: string) {
      calls.push(table)
      const result = data[table] ?? { data: null, error: null }
      const api: any = {
        select: () => api, eq: () => api,
        maybeSingle: async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null, error: result.error ?? null }),
        then: (resolve: any) => resolve({ data: result.data ?? [], error: result.error ?? null }),
      }
      return api
    },
  }
}

describe('loadPricingContext', () => {
  it('loads the role table and customer prices', async () => {
    const db = fakeDb({
      users: { data: { role: 'vip' } },
      roles: { data: { price_table_id: 't1' } },
      price_table_items: { data: [{ package_id: 'p1', price: '7.50' }] },
      customer_prices: { data: [{ package_id: 'p2', price: '3' }] },
    })
    const c = await loadPricingContext(db, 'u1')
    expect(c.role).toBe('vip')
    expect(c.tableId).toBe('t1')
    expect(c.tableItems.get('p1')).toBe(7.5)
    expect(c.overrides.get('p2')).toBe(3)
  })

  it('skips the user lookup when the role is already known, and the table lookup when the role has none', async () => {
    const calls: string[] = []
    const c = await loadPricingContext(fakeDb({ roles: { data: { price_table_id: null } } }, calls), 'u1', 'agent')
    expect(calls).toEqual(['roles', 'customer_prices'])
    expect(c.tableId).toBeNull()
    expect(c.tableItems.size).toBe(0)
  })

  it('throws when any read fails, so money paths can fail closed', async () => {
    await expect(loadPricingContext(fakeDb({ users: { error: { message: 'boom' } } }), 'u1')).rejects.toThrow(/customer/)
    await expect(loadPricingContext(fakeDb({ roles: { error: { message: 'boom' } } }), 'u1', 'agent')).rejects.toThrow(/role/)
    await expect(loadPricingContext(fakeDb({ roles: { data: { price_table_id: 't1' } }, price_table_items: { error: { message: 'boom' } } }), 'u1', 'x')).rejects.toThrow(/price table/)
    await expect(loadPricingContext(fakeDb({ customer_prices: { error: { message: 'boom' } } }), 'u1', 'agent')).rejects.toThrow(/customer prices/)
  })
})
