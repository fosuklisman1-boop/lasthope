import { describe, it, expect } from 'vitest'
import { getPriceForRole } from './pricing'

const pkg = {
  price: 10,
  agent_price: 9,
  super_agent_price: 8,
  premium_agent_price: 7,
  dealer_price: 6,
}

describe('getPriceForRole', () => {
  it('charges base price to customers and admins', () => {
    expect(getPriceForRole(pkg, 'user')).toBe(10)
    expect(getPriceForRole(pkg, 'admin')).toBe(10)
    expect(getPriceForRole(pkg, 'sub-admin')).toBe(10)
  })

  it('charges each reseller tier its own price', () => {
    expect(getPriceForRole(pkg, 'agent')).toBe(9)
    expect(getPriceForRole(pkg, 'super-agent')).toBe(8)
    expect(getPriceForRole(pkg, 'premium-agent')).toBe(7)
    expect(getPriceForRole(pkg, 'dealer')).toBe(6)
  })

  it('falls back to base price when a tier price is 0/unset', () => {
    expect(getPriceForRole({ price: 10, dealer_price: 0 }, 'dealer')).toBe(10)
    expect(getPriceForRole({ price: 10 }, 'agent')).toBe(10)
  })

  it('handles string/numeric inputs and bad roles', () => {
    expect(getPriceForRole({ price: '10', agent_price: '9' } as any, 'agent')).toBe(9)
    expect(getPriceForRole(pkg, undefined as any)).toBe(10)
  })
})
