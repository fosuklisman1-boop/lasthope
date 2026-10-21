import { ROLE_ICON_NAMES } from './roles'

/** Slugs a custom role may never use: they mean something elsewhere in the app. */
export const RESERVED_SLUGS = ['admin', 'sub-admin', 'user', 'customer', 'guest', 'system', 'all', 'none', 'null', 'undefined', 'owner', 'staff', 'moderator']

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_UPGRADE_PRICE = 100_000

/** "VIP Customers!" -> "vip-customers". Always starts with a letter and fits the slug rules. */
export function slugifyRole(label: string): string {
    let s = label
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    if (!/^[a-z]/.test(s)) s = s ? `role-${s}` : ''
    return s.slice(0, 38).replace(/-+$/, '')
}

export interface RoleFields {
    slug?: string
    label?: string
    color?: string
    icon?: string
    is_reseller?: boolean
    rank?: number
    price_table_id?: string | null
    upgrade_price?: number | null
    upgradable?: boolean
}

type Result = { ok: true; value: RoleFields } | { ok: false; error: string }

/**
 * Validate what an admin typed when creating or editing a role. Returns only the fields to write.
 * - create: label is required; the slug is derived from the label unless given
 * - update: only the fields present are checked and returned; the slug can never change
 */
export function validateRoleInput(input: Record<string, unknown>, mode: 'create' | 'update'): Result {
    const out: RoleFields = {}

    if (mode === 'create' || input.label !== undefined) {
        const label = typeof input.label === 'string' ? input.label.trim() : ''
        if (label.length < 1 || label.length > 40) return { ok: false, error: 'Give the role a name of up to 40 characters' }
        out.label = label
    }

    if (mode === 'create') {
        const slug = typeof input.slug === 'string' && input.slug.trim() ? input.slug.trim().toLowerCase() : slugifyRole(out.label ?? '')
        if (!SLUG_RE.test(slug)) return { ok: false, error: 'The role id must be 2 to 39 characters: lowercase letters, numbers and dashes, starting with a letter' }
        if (RESERVED_SLUGS.includes(slug)) return { ok: false, error: `"${slug}" is reserved. Choose a different name` }
        out.slug = slug
    } else if (input.slug !== undefined) {
        return { ok: false, error: 'A role id cannot be changed after it is created' }
    }

    if (input.color !== undefined) {
        if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return { ok: false, error: 'Colour must look like #1A2B3C' }
        out.color = input.color.toUpperCase()
    }

    if (input.icon !== undefined) {
        if (typeof input.icon !== 'string' || !ROLE_ICON_NAMES.includes(input.icon)) return { ok: false, error: 'Pick an icon from the list' }
        out.icon = input.icon
    }

    if (input.is_reseller !== undefined) {
        if (typeof input.is_reseller !== 'boolean') return { ok: false, error: 'is_reseller must be true or false' }
        out.is_reseller = input.is_reseller
    }

    if (input.rank !== undefined) {
        if (!Number.isInteger(input.rank) || (input.rank as number) < 1 || (input.rank as number) > 1000) return { ok: false, error: 'Order must be a whole number from 1 to 1000' }
        out.rank = input.rank as number
    }

    if (input.price_table_id !== undefined) {
        if (input.price_table_id !== null && (typeof input.price_table_id !== 'string' || !UUID_RE.test(input.price_table_id))) {
            return { ok: false, error: 'Invalid price table' }
        }
        out.price_table_id = input.price_table_id as string | null
    }

    if (input.upgrade_price !== undefined) {
        const p = input.upgrade_price
        if (p !== null) {
            if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > MAX_UPGRADE_PRICE) return { ok: false, error: `Upgrade price must be between 0.01 and ${MAX_UPGRADE_PRICE.toLocaleString('en-GB')}` }
            if (Math.abs(p * 100 - Math.round(p * 100)) > 1e-6) return { ok: false, error: 'Use at most two decimal places for the upgrade price' }
        }
        out.upgrade_price = p as number | null
    }

    if (input.upgradable !== undefined) {
        if (typeof input.upgradable !== 'boolean') return { ok: false, error: 'upgradable must be true or false' }
        out.upgradable = input.upgradable
    }

    return { ok: true, value: out }
}

/** A role can only be offered for purchase when it has an upgrade price. */
export function checkPurchasable(upgradable: boolean, upgradePrice: number | null): string | null {
    return upgradable && (upgradePrice === null || upgradePrice === undefined) ? 'Set an upgrade price before offering this role for purchase' : null
}
