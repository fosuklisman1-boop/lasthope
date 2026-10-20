import { describe, it, expect } from 'vitest'
import { parseSettingUpdates, diffSettings } from './settings-diff'

describe('parseSettingUpdates', () => {
    it('accepts a normal list and stringifies values', () => {
        const r = parseSettingUpdates([{ key: 'paystack_fee_percent', value: 1.95 }, { key: 'page_access_wallet', value: true }])
        expect(r).toEqual({ updates: [{ key: 'paystack_fee_percent', value: '1.95' }, { key: 'page_access_wallet', value: 'true' }] })
    })

    it('rejects empty, non-array, bad keys, duplicates and oversized values', () => {
        expect('error' in parseSettingUpdates([])).toBe(true)
        expect('error' in parseSettingUpdates('x')).toBe(true)
        expect('error' in parseSettingUpdates([{ key: 'Bad Key', value: '1' }])).toBe(true)
        expect('error' in parseSettingUpdates([{ key: 'a', value: '1' }, { key: 'a', value: '2' }])).toBe(true)
        expect('error' in parseSettingUpdates([{ key: 'a', value: 'x'.repeat(501) }])).toBe(true)
    })

    it('treats null and undefined values as an empty string', () => {
        expect(parseSettingUpdates([{ key: 'a', value: null }])).toEqual({ updates: [{ key: 'a', value: '' }] })
    })
})

describe('diffSettings', () => {
    it('returns only the values that changed, including new keys', () => {
        const changes = diffSettings({ a: '1', b: '2' }, [
            { key: 'a', value: '1' },
            { key: 'b', value: '3' },
            { key: 'c', value: '9' },
        ])
        expect(changes).toEqual([
            { key: 'b', from: '2', to: '3' },
            { key: 'c', from: null, to: '9' },
        ])
    })

    it('returns nothing when nothing changed', () => {
        expect(diffSettings({ a: '1' }, [{ key: 'a', value: '1' }])).toEqual([])
    })
})
