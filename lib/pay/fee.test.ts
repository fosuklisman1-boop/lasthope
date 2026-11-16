import { describe, it, expect } from 'vitest'
import { pickFeePercent, storefrontTotal, DEFAULT_FEE_PERCENT, GUEST_FEE_PERCENT, FEE_SETTING_KEYS } from './fee'
import { prepareTopup } from './prepare-wallet'

const settings = [
  { key: 'paystack_fee_percent', value: '2' },
  { key: 'agent_paystack_fee_percent', value: 1.5 },
]

describe('pickFeePercent (mirrors server loadFeePercent)', () => {
  it('constants', () => {
    expect(DEFAULT_FEE_PERCENT).toBe(1.95)
    expect(GUEST_FEE_PERCENT).toBe(1.95)
    expect(FEE_SETTING_KEYS).toEqual(['paystack_fee_percent', 'agent_paystack_fee_percent'])
  })
  it('agent role uses the agent key', () => {
    expect(pickFeePercent(settings, 'agent')).toBe(1.5)
  })
  it('non-agent roles use the standard key (server checks role === "agent" only)', () => {
    for (const r of ['user', 'customer', 'dealer', 'super_agent', 'admin', null, undefined]) {
      expect(pickFeePercent(settings, r as any)).toBe(2)
    }
  })
  it('agent falls back to the standard key when the agent key is missing', () => {
    expect(pickFeePercent([{ key: 'paystack_fee_percent', value: 2.5 }], 'agent')).toBe(2.5)
  })
  it('defaults to 1.95 when nothing / unparseable / falsy', () => {
    expect(pickFeePercent(null, 'user')).toBe(1.95)
    expect(pickFeePercent([], 'agent')).toBe(1.95)
    expect(pickFeePercent([{ key: 'paystack_fee_percent', value: 'abc' }], 'user')).toBe(1.95)
    expect(pickFeePercent([{ key: 'paystack_fee_percent', value: 0 }], 'user')).toBe(1.95)
  })
  it('server prepareTopup charges an agent the agent rate (same rule as the client)', async () => {
    const sb: any = {
      from(table: string) {
        const api: any = {
          select: () => api, eq: () => api, in: () => api,
          single: async () => ({ data: table === 'users' ? { role: 'agent' } : table === 'wallets' ? { id: 'w1' } : null, error: null }),
          then: (res: any, rej: any) => Promise.resolve({ data: table === 'admin_settings' ? settings : [], error: null }).then(res, rej),
          insert: () => ({ then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej) }),
        }
        return api
      },
    }
    const r = await prepareTopup(sb, { userId: 'u1', email: 'a@b.c', amount: 100 })
    expect(r.totalAmount).toBe(100 + 100 * pickFeePercent(settings, 'agent') / 100)
  })
})

describe('storefrontTotal', () => {
  it('adds the 1.95% guest fee, rounded to pesewas', () => {
    expect(storefrontTotal(10)).toBe(10.2)
    expect(storefrontTotal(100)).toBe(101.95)
    expect(storefrontTotal(7.5)).toBe(7.65)
  })
})
