import { describe, it, expect } from 'vitest'
import { parsePrice, parseItemUpdates, diffItems, belowCost, discountedPrice } from './price-tables'

const A = '123e4567-e89b-12d3-a456-426614174000'
const B = '123e4567-e89b-12d3-a456-426614174001'

describe('parsePrice', () => {
    it('accepts positive prices with up to two decimals, as numbers or strings', () => {
        expect(parsePrice(5.5)).toEqual({ ok: true, price: 5.5 })
        expect(parsePrice('3.75')).toEqual({ ok: true, price: 3.75 })
        expect(parsePrice(0.1 + 0.2)).toEqual({ ok: true, price: 0.3 })
    })
    it.each([0, -1, '', '   ', 'abc', NaN, null, undefined, 100001, 1.234])('rejects %s', (v) => {
        expect(parsePrice(v as any).ok).toBe(false)
    })
})

describe('parseItemUpdates', () => {
    it('accepts prices and nulls', () => {
        expect(parseItemUpdates([{ packageId: A, price: 5 }, { packageId: B, price: null }]))
            .toEqual({ ok: true, items: [{ packageId: A, price: 5 }, { packageId: B, price: null }] })
    })
    it('rejects empty, oversized, malformed and duplicate lists', () => {
        expect(parseItemUpdates([]).ok).toBe(false)
        expect(parseItemUpdates('x').ok).toBe(false)
        expect(parseItemUpdates([{ packageId: 'nope', price: 1 }]).ok).toBe(false)
        expect(parseItemUpdates([{ packageId: A, price: 1 }, { packageId: A, price: 2 }]).ok).toBe(false)
        expect(parseItemUpdates([{ packageId: A, price: -2 }]).ok).toBe(false)
        expect(parseItemUpdates(Array.from({ length: 501 }, () => ({ packageId: A, price: 1 }))).ok).toBe(false)
    })
})

describe('diffItems', () => {
    it('reports only real changes, including additions and removals', () => {
        const current = new Map([[A, 5], [B, 3]])
        expect(diffItems(current, [{ packageId: A, price: 5 }, { packageId: B, price: null }, { packageId: 'c', price: 9 }]))
            .toEqual([{ packageId: B, from: 3, to: null }, { packageId: 'c', from: null, to: 9 }])
    })
    it('treats removing a price that was never set as no change', () => {
        expect(diffItems(new Map(), [{ packageId: A, price: null }])).toEqual([])
    })
})

describe('belowCost', () => {
    it('warns only when a known cost exceeds the price', () => {
        expect(belowCost(4, 5)).toBe(true)
        expect(belowCost(5, 5)).toBe(false)
        expect(belowCost(4, 0)).toBe(false)
        expect(belowCost(4, null)).toBe(false)
        expect(belowCost(null, 5)).toBe(false)
        expect(belowCost(4, '5' as any)).toBe(true)
    })
})

describe('discountedPrice', () => {
    it('takes a percentage off and rounds to pesewas', () => {
        expect(discountedPrice(6, 10)).toBe(5.4)
        expect(discountedPrice(6, 0)).toBe(6)
        expect(discountedPrice(0.01, 50)).toBe(0.01) // never goes below the smallest valid price
        expect(discountedPrice(3.33, 33)).toBe(2.23)
    })
    it('rejects nonsense', () => {
        expect(discountedPrice(0, 10)).toBeNull()
        expect(discountedPrice(6, 100)).toBeNull()
        expect(discountedPrice(6, -5)).toBeNull()
    })
})

import { parseSizeGb, priceFromRate } from './price-tables'

describe('parseSizeGb', () => {
    it('reads common size formats as gigabytes', () => {
        expect(parseSizeGb('5GB')).toBe(5)
        expect(parseSizeGb('1.5 gb')).toBe(1.5)
        expect(parseSizeGb('10')).toBe(10)
        expect(parseSizeGb('500MB')).toBe(0.5)
        expect(parseSizeGb('1TB')).toBe(1000)
    })
    it('returns null for sizes it cannot read', () => {
        for (const s of ['Unlimited', '', '5 GB + 2 GB night', 'GB', '0GB', null, undefined]) expect(parseSizeGb(s as any)).toBeNull()
    })
})

describe('priceFromRate', () => {
    it('multiplies size by the rate and rounds to pesewas', () => {
        expect(priceFromRate(5, 3.9)).toBe(19.5)
        expect(priceFromRate(1.5, 3.9)).toBe(5.85)
        expect(priceFromRate(0.5, 3.9)).toBe(1.95)
        expect(priceFromRate(3, 3.33)).toBe(9.99)
    })
    it('rounds to the chosen step', () => {
        expect(priceFromRate(5, 3.93, 0.1)).toBe(19.7)
        expect(priceFromRate(5, 3.93, 0.5)).toBe(19.5)
        expect(priceFromRate(7, 3.9, 0.5)).toBe(27.5)
    })
    it('rejects nonsense', () => {
        expect(priceFromRate(0, 3.9)).toBeNull()
        expect(priceFromRate(5, 0)).toBeNull()
        expect(priceFromRate(5, 3.9, 0)).toBeNull()
        expect(priceFromRate(0.001, 1)).toBeNull()
    })
})

import { planRatePrices } from './price-tables'

describe('planRatePrices', () => {
    const rows = [
        { id: 'a', network: 'MTN', size: '1GB', current: '' },
        { id: 'b', network: 'MTN', size: '5GB', current: 20 },
        { id: 'c', network: 'MTN', size: 'Unlimited', current: null },
        { id: 'd', network: 'Telecel', size: '2GB', current: undefined },
    ]
    const base = { ratePerGb: 3.9, step: 0.01, network: 'all', overwrite: false }

    it('fills only empty prices by default and counts what it kept', () => {
        const p = planRatePrices(rows, base)
        expect(p.updates).toEqual({ a: 3.9, d: 7.8 })
        expect(p.keptExisting).toBe(1)
        expect(p.skippedUnreadable).toEqual(['MTN Unlimited'])
    })
    it('replaces existing prices when overwrite is on', () => {
        expect(planRatePrices(rows, { ...base, overwrite: true }).updates).toEqual({ a: 3.9, b: 19.5, d: 7.8 })
    })
    it('limits to one network', () => {
        expect(planRatePrices(rows, { ...base, network: 'Telecel', overwrite: true }).updates).toEqual({ d: 7.8 })
    })
    it('applies the rounding step', () => {
        expect(planRatePrices(rows, { ...base, ratePerGb: 3.93, step: 0.5, overwrite: true }).updates).toEqual({ a: 4, b: 19.5, d: 8 })
    })
    it('changes nothing for an invalid rate', () => {
        expect(planRatePrices(rows, { ...base, ratePerGb: 0 }).updates).toEqual({})
    })
})
