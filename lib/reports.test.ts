import { describe, it, expect } from 'vitest'
import { classifyTrend, fillDays, toCsv, parseRange } from './reports'

describe('classifyTrend', () => {
    const t = (revenue_cur: number, revenue_prev: number) => classifyTrend({ revenue_cur, revenue_prev })

    it('marks no activity in either period as inactive', () => {
        expect(t(0, 0)).toEqual({ trend: 'inactive', changePct: null })
    })
    it('marks a reseller who stopped as churned', () => {
        expect(t(0, 500)).toEqual({ trend: 'churned', changePct: -100 })
    })
    it('marks first-time activity as new', () => {
        expect(t(300, 0)).toEqual({ trend: 'new', changePct: null })
    })
    it('uses a 20% band to separate growing, steady and declining', () => {
        expect(t(120, 100)).toEqual({ trend: 'growing', changePct: 20 })
        expect(t(119, 100)).toMatchObject({ trend: 'steady' })
        expect(t(81, 100)).toMatchObject({ trend: 'steady' })
        expect(t(80, 100)).toEqual({ trend: 'declining', changePct: -20 })
    })
    it('accepts numeric strings from the database', () => {
        expect(classifyTrend({ revenue_cur: '200' as any, revenue_prev: '100' as any }).trend).toBe('growing')
    })
})

describe('fillDays', () => {
    it('returns one row per day with zeros where there were no orders', () => {
        const rows = fillDays([{ day: '2026-10-02', orders: 3, revenue: 30, profit: 5 }], '2026-10-01', '2026-10-03')
        expect(rows).toEqual([
            { day: '2026-10-01', orders: 0, revenue: 0, profit: 0 },
            { day: '2026-10-02', orders: 3, revenue: 30, profit: 5 },
            { day: '2026-10-03', orders: 0, revenue: 0, profit: 0 },
        ])
    })
    it('handles a single day', () => {
        expect(fillDays([], '2026-10-01', '2026-10-01')).toHaveLength(1)
    })
})

describe('toCsv', () => {
    it('quotes cells with commas, quotes and newlines', () => {
        expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', 5]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",5\r\n')
    })
    it('defuses spreadsheet formulas', () => {
        expect(toCsv(['v'], [['=SUM(A1)'], ['+1'], ['-2'], ['@cmd']])).toBe("v\r\n'=SUM(A1)\r\n'+1\r\n'-2\r\n'@cmd\r\n")
    })
})

describe('parseRange', () => {
    const NOW = new Date('2026-10-20T10:00:00Z')
    it('defaults to the last 30 days ending today', () => {
        expect(parseRange(null, null, NOW)).toEqual({ ok: true, from: '2026-09-21', to: '2026-10-20' })
    })
    it('accepts a valid range', () => {
        expect(parseRange('2026-10-01', '2026-10-10', NOW)).toEqual({ ok: true, from: '2026-10-01', to: '2026-10-10' })
    })
    it('rejects reversed and oversized ranges', () => {
        expect(parseRange('2026-10-10', '2026-10-01', NOW)).toMatchObject({ ok: false })
        expect(parseRange('2025-01-01', '2026-10-01', NOW)).toMatchObject({ ok: false })
    })
    it('falls back to defaults for malformed dates', () => {
        expect(parseRange('nonsense', 'also-bad', NOW)).toEqual({ ok: true, from: '2026-09-21', to: '2026-10-20' })
    })
})
