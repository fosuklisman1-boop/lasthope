import { describe, it, expect } from 'vitest'
import { shopPrice, resolvePrice, emptyPricingContext } from './pricing'

describe('shopPrice', () => {
    it('uses the shop custom price when it is positive', () => {
        expect(shopPrice(5, { custom_price: 8, profit_margin: 1 })).toBe(8)
        expect(shopPrice(5, { custom_price: '8.00', profit_margin: '1.00' })).toBe(8)
    })
    it('adds the margin to the owner cost when there is no custom price', () => {
        expect(shopPrice(5, { custom_price: null, profit_margin: 1.5 })).toBe(6.5)
        expect(shopPrice(5, { custom_price: 0, profit_margin: '2.00' })).toBe(7)
    })
    it('charges the owner cost when there is no config or a zero margin', () => {
        expect(shopPrice(5, null)).toBe(5)
        expect(shopPrice(5, undefined)).toBe(5)
        expect(shopPrice(5, { custom_price: null, profit_margin: 0 })).toBe(5)
        expect(shopPrice(5, { custom_price: null, profit_margin: '0.00' })).toBe(5)
    })
})

describe('storefront shows what checkout charges', () => {
    // The bug: the storefront used base price + margin, checkout used the owner's tier cost + margin.
    const pkg = { id: 'p1', price: 6, dealer_price: 3.75 }
    const owner = { ...emptyPricingContext('dealer') }

    it('uses the owner cost for a reseller owner, not the base price', () => {
        const cost = resolvePrice(pkg, owner)
        expect(cost).toBe(3.75)
        expect(shopPrice(cost, { profit_margin: 1 })).toBe(4.75) // not 7 (6 + 1)
    })

    it('follows a price table on the owner role and a custom price for the owner', () => {
        const withTable = { ...owner, tableId: 't', tableItems: new Map([['p1', 3]]) }
        expect(shopPrice(resolvePrice(pkg, withTable), { profit_margin: 1 })).toBe(4)
        const withOwn = { ...withTable, overrides: new Map([['p1', 2.5]]) }
        expect(shopPrice(resolvePrice(pkg, withOwn), { profit_margin: 1 })).toBe(3.5)
    })
})
