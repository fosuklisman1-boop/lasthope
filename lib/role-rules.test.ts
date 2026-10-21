import { describe, it, expect } from 'vitest'
import { slugifyRole, validateRoleInput, checkPurchasable } from './role-rules'
import { getRoleConfig, isResellerRole, setRoleRegistry, getRoleRegistry, type RoleInfo } from './roles'

describe('slugifyRole', () => {
    it('makes a clean slug', () => {
        expect(slugifyRole('VIP Customers!')).toBe('vip-customers')
        expect(slugifyRole('  Café   Owners ')).toBe('cafe-owners')
    })
    it('always starts with a letter and stays within the length limit', () => {
        expect(slugifyRole('24/7 Partners')).toBe('role-24-7-partners')
        expect(slugifyRole('x'.repeat(80)).length).toBeLessThanOrEqual(38)
        expect(slugifyRole('!!!')).toBe('')
    })
})

describe('validateRoleInput create', () => {
    it('derives the slug from the label', () => {
        expect(validateRoleInput({ label: 'VIP Customers', color: '#aabbcc', icon: 'Gem' }, 'create'))
            .toEqual({ ok: true, value: { label: 'VIP Customers', slug: 'vip-customers', color: '#AABBCC', icon: 'Gem' } })
    })
    it('requires a name', () => {
        expect(validateRoleInput({}, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: '   ' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: 'x'.repeat(41) }, 'create')).toMatchObject({ ok: false })
    })
    it('refuses reserved and malformed ids', () => {
        expect(validateRoleInput({ label: 'Admin' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: 'Anything', slug: 'sub-admin' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: 'Anything', slug: 'Bad Slug' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: '!!!' }, 'create')).toMatchObject({ ok: false })
    })
    it('checks colour, icon, order, flags and upgrade price', () => {
        const base = { label: 'Gold' }
        expect(validateRoleInput({ ...base, color: 'red' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, icon: 'Skull' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, rank: 0 }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, rank: 1.5 }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, is_reseller: 'yes' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, upgrade_price: 0 }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, upgrade_price: 10.123 }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ ...base, upgrade_price: 99.5, upgradable: true }, 'create')).toMatchObject({ ok: true })
    })
    it('validates the price table id', () => {
        expect(validateRoleInput({ label: 'Gold', price_table_id: 'nope' }, 'create')).toMatchObject({ ok: false })
        expect(validateRoleInput({ label: 'Gold', price_table_id: null }, 'create')).toMatchObject({ ok: true })
        expect(validateRoleInput({ label: 'Gold', price_table_id: '123e4567-e89b-12d3-a456-426614174000' }, 'create')).toMatchObject({ ok: true })
    })
})

describe('validateRoleInput update', () => {
    it('returns only the fields that were sent', () => {
        expect(validateRoleInput({ color: '#112233' }, 'update')).toEqual({ ok: true, value: { color: '#112233' } })
        expect(validateRoleInput({}, 'update')).toEqual({ ok: true, value: {} })
    })
    it('never allows the id to change', () => {
        expect(validateRoleInput({ slug: 'other' }, 'update')).toMatchObject({ ok: false })
    })
    it('allows clearing the upgrade price and the price table', () => {
        expect(validateRoleInput({ upgrade_price: null, price_table_id: null }, 'update')).toEqual({ ok: true, value: { upgrade_price: null, price_table_id: null } })
    })
})

describe('checkPurchasable', () => {
    it('needs a price to be offered', () => {
        expect(checkPurchasable(true, null)).toMatch(/upgrade price/)
        expect(checkPurchasable(true, 50)).toBeNull()
        expect(checkPurchasable(false, null)).toBeNull()
    })
})

describe('role registry', () => {
    const vip: RoleInfo = { slug: 'vip', label: 'VIP', kind: 'custom', is_reseller: true, color: '#FF8800', icon: 'Gem', rank: 50, upgradable: true, upgrade_price: 99 }

    it('shows custom roles and falls back safely for unknown ones', () => {
        setRoleRegistry([vip])
        expect(getRoleConfig('vip')).toMatchObject({ label: 'VIP', color: '#FF8800', bgColor: 'rgba(255, 136, 0, 0.1)' })
        expect(getRoleConfig('mystery-role').label).toBe('Mystery Role')
        expect(getRoleConfig(null).label).toBe('Customer')
        expect(getRoleConfig('agent').label).toBe('Agent')
        setRoleRegistry([])
    })

    it('lets a stored role decide whether it counts as a reseller', () => {
        setRoleRegistry([vip])
        expect(isResellerRole('vip')).toBe(true)
        expect(isResellerRole('dealer')).toBe(true) // built-in, not in the registry
        expect(isResellerRole('user')).toBe(false)
        setRoleRegistry([{ ...vip, is_reseller: false }])
        expect(isResellerRole('vip')).toBe(false)
        setRoleRegistry([])
        expect(isResellerRole('vip')).toBe(false)
    })

    it('lists roles by order', () => {
        setRoleRegistry([{ ...vip, slug: 'b', rank: 9 }, { ...vip, slug: 'a', rank: 2 }])
        expect(getRoleRegistry().map(r => r.slug)).toEqual(['a', 'b'])
        setRoleRegistry([])
    })
})
