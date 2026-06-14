import { RESELLER_TIERS, TIER_PRICE_FIELD, UserRole } from './roles'

export interface PackagePricing {
  price: number | string
  agent_price?: number | string | null
  super_agent_price?: number | string | null
  premium_agent_price?: number | string | null
  dealer_price?: number | string | null
  [key: string]: unknown
}

/**
 * Returns the price a given role pays for a package.
 * Reseller tiers pay their own column when it is > 0; everyone else (and any
 * tier with an unset/0 price) falls back to the base `price`.
 */
export function getPriceForRole(pkg: PackagePricing, role: UserRole | string | null | undefined): number {
  const base = Number(pkg.price) || 0
  if (role && (RESELLER_TIERS as string[]).includes(role)) {
    const field = TIER_PRICE_FIELD[role]
    const tierPrice = Number(pkg[field] ?? 0)
    if (tierPrice > 0) return tierPrice
  }
  return base
}
