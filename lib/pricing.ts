import { RESELLER_TIERS, TIER_PRICE_FIELD, UserRole } from './roles'

export interface PackagePricing {
  id?: string
  price: number | string
  agent_price?: number | string | null
  super_agent_price?: number | string | null
  premium_agent_price?: number | string | null
  dealer_price?: number | string | null
  [key: string]: unknown
}

/**
 * Returns the price a given role pays for a package, from the legacy per-tier columns.
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

/**
 * Everything needed to price packages for one customer.
 * - overrides: this customer's own price per package (set by an admin)
 * - tableId / tableItems: the price table attached to the customer's role, if any
 */
export interface PricingContext {
  role: string | null
  tableId: string | null
  tableItems: Map<string, number>
  overrides: Map<string, number>
}

export function emptyPricingContext(role: string | null = null): PricingContext {
  return { role, tableId: null, tableItems: new Map(), overrides: new Map() }
}

export type PriceSource = 'customer' | 'table' | 'tier' | 'base'

/**
 * The price a customer pays for a package, and where it came from. In order:
 *  1. the customer's own price for this package
 *  2. the price in their role's price table (a package missing from the table costs the base price)
 *  3. for a role with no price table: the legacy per-tier column, then the base price
 */
export function resolvePriceDetail(pkg: PackagePricing, ctx: PricingContext): { price: number; source: PriceSource } {
  const base = Number(pkg.price) || 0
  const id = pkg.id

  if (id) {
    const own = ctx.overrides.get(id)
    if (own !== undefined && own > 0) return { price: own, source: 'customer' }
  }

  if (ctx.tableId) {
    const item = id ? ctx.tableItems.get(id) : undefined
    return item !== undefined && item > 0 ? { price: item, source: 'table' } : { price: base, source: 'base' }
  }

  const tier = getPriceForRole(pkg, ctx.role)
  return { price: tier, source: tier !== base ? 'tier' : 'base' }
}

export function resolvePrice(pkg: PackagePricing, ctx: PricingContext): number {
  return resolvePriceDetail(pkg, ctx).price
}

export interface ShopConfig {
  custom_price?: number | string | null
  profit_margin?: number | string | null
}

/**
 * What a shop customer pays for a package: the shop's own price if it set one, otherwise the
 * owner's cost plus the shop's margin, otherwise the owner's cost.
 */
export function shopPrice(ownerCost: number, config: ShopConfig | null | undefined): number {
  if (config) {
    const custom = Number(config.custom_price)
    if (custom > 0) return custom
    const margin = Number(config.profit_margin)
    if (margin) return ownerCost + margin
  }
  return ownerCost
}
