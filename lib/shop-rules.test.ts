import { describe, it, expect } from 'vitest'
import { maxShopPrice, clampShopPrice, effectiveLimit, parseLimitSetting, computeBalance, validateShopEdit } from './shop-rules'
import { shopPrice } from './pricing'

describe('margin cap', () => {
    it('allows cost plus the percentage', () => {
        expect(maxShopPrice(10, 30)).toBe(13)
        expect(maxShopPrice(3.75, 20)).toBe(4.5)
        expect(maxShopPrice(10, 0)).toBe(10)
    })
    it('has no cap when the percentage is not set', () => {
        expect(maxShopPrice(10, null)).toBe(Infinity)
        expect(maxShopPrice(10, undefined)).toBe(Infinity)
    })
    it('lowers a price that is over the cap and says so', () => {
        expect(clampShopPrice(20, 10, 30)).toEqual({ price: 13, capped: true })
        expect(clampShopPrice(12, 10, 30)).toEqual({ price: 12, capped: false })
        expect(clampShopPrice(99, 10, null)).toEqual({ price: 99, capped: false })
    })
    it('is applied by shopPrice for custom prices and margins alike', () => {
        expect(shopPrice(10, { custom_price: 25 }, 30)).toBe(13)
        expect(shopPrice(10, { profit_margin: 8 }, 30)).toBe(13)
        expect(shopPrice(10, { profit_margin: 2 }, 30)).toBe(12)
        expect(shopPrice(10, { custom_price: 25 }, null)).toBe(25)
        expect(shopPrice(10, null, 30)).toBe(10)
    })
})

describe('limits', () => {
    it('prefers the shop limit, then the platform limit', () => {
        expect(effectiveLimit(15, 30)).toBe(15)
        expect(effectiveLimit(0, 30)).toBe(0)
        expect(effectiveLimit(null, 30)).toBe(30)
        expect(effectiveLimit(undefined, null)).toBeNull()
    })
    it('treats empty, zero and junk settings as not set', () => {
        expect(parseLimitSetting('25')).toBe(25)
        expect(parseLimitSetting('0')).toBeNull()
        expect(parseLimitSetting('')).toBeNull()
        expect(parseLimitSetting('abc')).toBeNull()
        expect(parseLimitSetting(undefined)).toBeNull()
    })
})

describe('computeBalance', () => {
    it('adds live profit and the ledger, then takes off withdrawals', () => {
        expect(computeBalance({ orderProfit: 7.77, ledger: 3.75, withdrawn: 5, pending: 2 })).toMatchObject({ totalEarnings: 11.52, available: 4.52 })
    })
    it('can go negative after a clawback', () => {
        expect(computeBalance({ orderProfit: 0, ledger: -10, withdrawn: 0, pending: 0 }).available).toBe(-10)
    })
    it('does not change when old orders are archived into the ledger', () => {
        const before = computeBalance({ orderProfit: 11.52, ledger: 0, withdrawn: 0, pending: 0 })
        const after = computeBalance({ orderProfit: 7.77, ledger: 3.75, withdrawn: 0, pending: 0 })
        expect(after.available).toBe(before.available)
    })
    it('rounds floating point noise', () => {
        expect(computeBalance({ orderProfit: 0.1, ledger: 0.2, withdrawn: 0, pending: 0 }).totalEarnings).toBe(0.3)
    })
})

describe('validateShopEdit', () => {
    it('accepts valid changes and returns only what was sent', () => {
        expect(validateShopEdit({ name: ' Kofi Data ', description: '  Fast  ' })).toEqual({ ok: true, value: { name: 'Kofi Data', description: 'Fast' } })
        expect(validateShopEdit({ description: '' })).toEqual({ ok: true, value: { description: null } })
        expect(validateShopEdit({ logo_url: null })).toEqual({ ok: true, value: { logo_url: null } })
        expect(validateShopEdit({ slug: 'Kofi-Data' })).toEqual({ ok: true, value: { slug: 'kofi-data' } })
    })
    it('rejects bad names, addresses, colours and logo replacement', () => {
        expect(validateShopEdit({ name: 'x' }).ok).toBe(false)
        expect(validateShopEdit({ name: 'x'.repeat(61) }).ok).toBe(false)
        expect(validateShopEdit({ slug: 'a b' }).ok).toBe(false)
        expect(validateShopEdit({ slug: 'ab' }).ok).toBe(false)
        expect(validateShopEdit({ slug: '-bad-' }).ok).toBe(false)
        expect(validateShopEdit({ slug: 'double--dash' }).ok).toBe(false)
        expect(validateShopEdit({ theme_color: 'red' }).ok).toBe(false)
        expect(validateShopEdit({ logo_url: 'https://x.test/a.png' }).ok).toBe(false)
        expect(validateShopEdit({ description: 'x'.repeat(301) }).ok).toBe(false)
    })
})
