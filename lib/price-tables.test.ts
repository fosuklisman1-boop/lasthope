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
