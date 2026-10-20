export interface DayRow { day: string; orders: number; revenue: number; profit: number }

export type Trend = 'growing' | 'steady' | 'declining' | 'churned' | 'new' | 'inactive'

export interface ResellerActivity {
    user_id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    role: string
    joined_at: string
    orders_cur: number
    revenue_cur: number
    orders_prev: number
    revenue_prev: number
    last_order_at: string | null
}

const GROWTH = 1.2
const DECLINE = 0.8

/** Pure: how is this reseller doing compared with the previous period? */
export function classifyTrend(r: Pick<ResellerActivity, 'revenue_cur' | 'revenue_prev'>): { trend: Trend; changePct: number | null } {
    const cur = Number(r.revenue_cur)
    const prev = Number(r.revenue_prev)
    if (cur === 0 && prev === 0) return { trend: 'inactive', changePct: null }
    if (prev > 0 && cur === 0) return { trend: 'churned', changePct: -100 }
    if (prev === 0) return { trend: 'new', changePct: null }
    const ratio = cur / prev
    const changePct = Math.round((ratio - 1) * 100)
    if (ratio >= GROWTH) return { trend: 'growing', changePct }
    if (ratio <= DECLINE) return { trend: 'declining', changePct }
    return { trend: 'steady', changePct }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Pure: one row per calendar day in [from, to], zero-filled, so charts have no gaps. */
export function fillDays(rows: DayRow[], from: string, to: string): DayRow[] {
    const byDay = new Map(rows.map(r => [String(r.day).slice(0, 10), r]))
    const out: DayRow[] = []
    const end = new Date(`${to}T00:00:00Z`)
    for (let d = new Date(`${from}T00:00:00Z`); d <= end; d = new Date(d.getTime() + 86400000)) {
        const key = iso(d)
        const r = byDay.get(key)
        out.push({ day: key, orders: Number(r?.orders ?? 0), revenue: Number(r?.revenue ?? 0), profit: Number(r?.profit ?? 0) })
    }
    return out
}

function csvCell(v: unknown): string {
    const s = String(v ?? '')
    // Quote anything with a delimiter, quote or newline; defuse spreadsheet formulas.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
    return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Validate a from/to pair of YYYY-MM-DD strings; defaults to the last 30 days. */
export function parseRange(from: string | null, to: string | null, now: Date = new Date(), maxDays = 366):
    { ok: true; from: string; to: string } | { ok: false; error: string } {
    const re = /^\d{4}-\d{2}-\d{2}$/
    const toStr = to && re.test(to) ? to : iso(now)
    const fromStr = from && re.test(from) ? from : iso(new Date(new Date(`${toStr}T00:00:00Z`).getTime() - 29 * 86400000))
    const a = new Date(`${fromStr}T00:00:00Z`)
    const b = new Date(`${toStr}T00:00:00Z`)
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return { ok: false, error: 'Invalid date' }
    if (a > b) return { ok: false, error: 'The start date must be before the end date' }
    if ((b.getTime() - a.getTime()) / 86400000 + 1 > maxDays) return { ok: false, error: `Pick a range of at most ${maxDays} days` }
    return { ok: true, from: fromStr, to: toStr }
}
