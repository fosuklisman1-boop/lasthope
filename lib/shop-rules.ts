/** Highest price a shop may charge: the owner's cost plus the allowed margin. No cap when the percentage is not set. */
export function maxShopPrice(ownerCost: number, maxMarginPercent: number | null | undefined): number {
    if (maxMarginPercent === null || maxMarginPercent === undefined || !Number.isFinite(maxMarginPercent)) return Infinity
    return Math.round(ownerCost * (1 + maxMarginPercent / 100) * 100) / 100
}

/** Hold a price to the cap. Reports whether it had to be lowered. */
export function clampShopPrice(price: number, ownerCost: number, maxMarginPercent: number | null | undefined): { price: number; capped: boolean } {
    const max = maxShopPrice(ownerCost, maxMarginPercent)
    return price > max ? { price: max, capped: true } : { price, capped: false }
}

/** A shop's own limit wins; otherwise the platform-wide one; otherwise none. */
export function effectiveLimit(perShop: number | null | undefined, platform: number | null | undefined): number | null {
    if (perShop !== null && perShop !== undefined) return perShop
    return platform ?? null
}

/** Parse a platform setting such as shop_max_margin_percent. Empty, zero or junk means "not set". */
export function parseLimitSetting(value: string | null | undefined): number | null {
    const n = parseFloat(value ?? '')
    return Number.isFinite(n) && n > 0 ? n : null
}

export interface BalanceParts {
    /** Profit on the shop's live paid orders. */
    orderProfit: number
    /** Sum of the profit ledger: adjustments, reversals and archived profit. */
    ledger: number
    /** Withdrawals already approved. */
    withdrawn: number
    /** Withdrawal requests waiting for approval. */
    pending: number
}

export interface Balance extends BalanceParts {
    totalEarnings: number
    /** What the owner could still request: earnings minus approved and pending withdrawals. */
    available: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeBalance(p: BalanceParts): Balance {
    const totalEarnings = round2(p.orderProfit + p.ledger)
    return {
        ...p,
        orderProfit: round2(p.orderProfit),
        ledger: round2(p.ledger),
        withdrawn: round2(p.withdrawn),
        pending: round2(p.pending),
        totalEarnings,
        available: round2(totalEarnings - p.withdrawn - p.pending),
    }
}

const SHOP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface ShopEdit {
    name?: string
    description?: string | null
    logo_url?: string | null
    slug?: string
    theme_color?: string
}

/** Validate what an admin changes on a shop's public profile. */
export function validateShopEdit(input: Record<string, unknown>): { ok: true; value: ShopEdit } | { ok: false; error: string } {
    const out: ShopEdit = {}

    if (input.name !== undefined) {
        const name = typeof input.name === 'string' ? input.name.trim() : ''
        if (name.length < 2 || name.length > 60) return { ok: false, error: 'A shop name must be 2 to 60 characters' }
        out.name = name
    }
    if (input.description !== undefined) {
        if (input.description !== null && typeof input.description !== 'string') return { ok: false, error: 'Invalid description' }
        const d = (input.description as string | null)?.trim() ?? ''
        if (d.length > 300) return { ok: false, error: 'A description can be up to 300 characters' }
        out.description = d || null
    }
    if (input.logo_url !== undefined) {
        if (input.logo_url !== null && input.logo_url !== '') return { ok: false, error: 'Logos can only be cleared here, not replaced' }
        out.logo_url = null
    }
    if (input.slug !== undefined) {
        const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : ''
        if (slug.length < 3 || slug.length > 60 || !SHOP_SLUG_RE.test(slug)) return { ok: false, error: 'The shop address must be 3 to 60 characters: lowercase letters, numbers and single dashes' }
        out.slug = slug
    }
    if (input.theme_color !== undefined) {
        if (typeof input.theme_color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(input.theme_color)) return { ok: false, error: 'Colour must look like #1A2B3C' }
        out.theme_color = input.theme_color
    }
    return { ok: true, value: out }
}
