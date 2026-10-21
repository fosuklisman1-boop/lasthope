import { describe, it, expect } from 'vitest'
import { loadShopControls, loadShopLimits, loadBlockedPackageIds, loadShopBalance, limitsFor, NO_CONTROLS, SHOP_SETTING_KEYS } from './shop-data'

type Result = { data?: any; error?: any }

function fakeDb(tables: Record<string, Result>, rpcs: Record<string, Result> = {}) {
    return {
        from(table: string) {
            const r = tables[table] ?? { data: null }
            const api: any = {
                select: () => api, eq: () => api, in: () => api,
                maybeSingle: async () => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null, error: r.error ?? null }),
                then: (resolve: any) => resolve({ data: r.data ?? [], error: r.error ?? null }),
            }
            return api
        },
        rpc(name: string) {
            const r = rpcs[name] ?? { data: null }
            return { single: async () => ({ data: r.data ?? null, error: r.error ?? null }) }
        },
    }
}

describe('loadShopControls', () => {
    it('returns no restrictions for a shop without a controls row', async () => {
        expect(await loadShopControls(fakeDb({ shop_controls: { data: null } }), 's1')).toEqual(NO_CONTROLS)
    })
    it('reads a suspended shop with a held withdrawal and numeric limits', async () => {
        const c = await loadShopControls(fakeDb({ shop_controls: { data: { suspended: true, suspended_message: 'Closed', withdrawals_held: true, max_margin_percent: '25.00', min_withdrawal: '10.00', profile_locked: true } } }), 's1')
        expect(c).toMatchObject({ suspended: true, suspended_message: 'Closed', withdrawals_held: true, max_margin_percent: 25, min_withdrawal: 10, profile_locked: true })
    })
    it('throws when it cannot read, so money paths refuse instead of assuming "no restrictions"', async () => {
        await expect(loadShopControls(fakeDb({ shop_controls: { error: { message: 'boom' } } }), 's1')).rejects.toThrow(/shop controls/)
    })
})

describe('loadShopLimits', () => {
    it('parses the platform settings and treats empty as no limit', async () => {
        const limits = await loadShopLimits(fakeDb({ admin_settings: { data: [{ key: SHOP_SETTING_KEYS.maxMarginPercent, value: '30' }, { key: SHOP_SETTING_KEYS.minWithdrawal, value: '' }] } }))
        expect(limits).toEqual({ maxMarginPercent: 30, minWithdrawal: null })
    })
    it('throws on a read error instead of silently allowing everything', async () => {
        await expect(loadShopLimits(fakeDb({ admin_settings: { error: { message: 'boom' } } }))).rejects.toThrow(/shop limits/)
    })
})

describe('limitsFor', () => {
    it('lets a shop override the platform limits, and falls back to them', () => {
        const platform = { maxMarginPercent: 30, minWithdrawal: 10 }
        expect(limitsFor({ ...NO_CONTROLS, max_margin_percent: 15 }, platform)).toEqual({ maxMarginPercent: 15, minWithdrawal: 10 })
        expect(limitsFor(NO_CONTROLS, platform)).toEqual(platform)
        expect(limitsFor(NO_CONTROLS, { maxMarginPercent: null, minWithdrawal: null })).toEqual({ maxMarginPercent: null, minWithdrawal: null })
    })
})

describe('loadBlockedPackageIds', () => {
    it('returns the ids as a set', async () => {
        const ids = await loadBlockedPackageIds(fakeDb({ shop_blocked_packages: { data: [{ package_id: 'a' }, { package_id: 'b' }] } }), 's1')
        expect([...ids].sort()).toEqual(['a', 'b'])
    })
})

describe('loadShopBalance', () => {
    it('adds live profit and the ledger and subtracts approved and pending withdrawals', async () => {
        const db = fakeDb(
            { withdrawals: { data: [{ amount: '5', status: 'approved' }, { amount: '2', status: 'pending' }] } },
            { shop_profit_parts: { data: { order_profit: '7.77', ledger: '3.75' } } }
        )
        expect(await loadShopBalance(db, 's1', 'u1')).toMatchObject({ totalEarnings: 11.52, withdrawn: 5, pending: 2, available: 4.52 })
    })
    it('throws when the profit cannot be read', async () => {
        await expect(loadShopBalance(fakeDb({}, { shop_profit_parts: { error: { message: 'boom' } } }), 's1', 'u1')).rejects.toThrow(/shop profit/)
    })
})
