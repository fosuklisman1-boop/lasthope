import { describe, it, expect } from 'vitest'
import { roleConfig, RESELLER_TIERS, isResellerRole, TIER_PRICE_FIELD, UserRole } from './roles'

describe('roles', () => {
  it('has config entries for all new tiers', () => {
    for (const r of ['super-agent', 'premium-agent', 'dealer'] as UserRole[]) {
      expect(roleConfig[r]).toBeDefined()
      expect(roleConfig[r].label.length).toBeGreaterThan(0)
    }
  })

  it('orders reseller tiers base->cheapest', () => {
    expect(RESELLER_TIERS).toEqual(['agent', 'super-agent', 'premium-agent', 'dealer'])
  })

  it('identifies reseller roles', () => {
    expect(isResellerRole('agent')).toBe(true)
    expect(isResellerRole('dealer')).toBe(true)
    expect(isResellerRole('user')).toBe(false)
    expect(isResellerRole('admin')).toBe(false)
  })

  it('maps each tier to its price column', () => {
    expect(TIER_PRICE_FIELD['agent']).toBe('agent_price')
    expect(TIER_PRICE_FIELD['super-agent']).toBe('super_agent_price')
    expect(TIER_PRICE_FIELD['premium-agent']).toBe('premium_agent_price')
    expect(TIER_PRICE_FIELD['dealer']).toBe('dealer_price')
  })
})
