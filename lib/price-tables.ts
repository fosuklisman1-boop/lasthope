const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MAX_PRICE = 100_000
export const MAX_ITEMS_PER_UPDATE = 500

/** A price to set, or null to remove the price so the package falls back to the base price. */
export interface ItemUpdate {
    packageId: string
    price: number | null
}

export interface ItemChange {
    packageId: string
    from: number | null
    to: number | null
}

/** Validate one price an admin typed. Returns the price (2 decimals) or an error. */
export function parsePrice(value: unknown): { ok: true; price: number } | { ok: false; error: string } {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
    if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return { ok: false, error: `A price must be between 0.01 and ${MAX_PRICE.toLocaleString('en-GB')}` }
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: 'Use at most two decimal places' }
    return { ok: true, price: Math.round(n * 100) / 100 }
}

export function parseItemUpdates(input: unknown): { ok: true; items: ItemUpdate[] } | { ok: false; error: string } {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'items must be a non-empty list' }
    if (input.length > MAX_ITEMS_PER_UPDATE) return { ok: false, error: `Change at most ${MAX_ITEMS_PER_UPDATE} prices at a time` }

    const seen = new Set<string>()
    const items: ItemUpdate[] = []
    for (const raw of input) {
        const packageId = typeof raw?.packageId === 'string' ? raw.packageId : ''
        if (!UUID_RE.test(packageId)) return { ok: false, error: 'Each item needs a valid packageId' }
        if (seen.has(packageId)) return { ok: false, error: 'The same package appears twice' }
        seen.add(packageId)

        if (raw.price === null) {
            items.push({ packageId, price: null })
            continue
        }
        const p = parsePrice(raw.price)
        if (!p.ok) return p
        items.push({ packageId, price: p.price })
    }
    return { ok: true, items }
}

/** Only the prices that actually change. */
export function diffItems(current: Map<string, number>, updates: ItemUpdate[]): ItemChange[] {
    const changes: ItemChange[] = []
    for (const u of updates) {
        const from = current.has(u.packageId) ? current.get(u.packageId)! : null
        if (from !== u.price) changes.push({ packageId: u.packageId, from, to: u.price })
    }
    return changes
}

/** A price at or below the cost price means a loss on every sale. Zero cost means unknown, so no warning. */
export function belowCost(price: number | null, cost: number | null | undefined): boolean {
    const c = Number(cost) || 0
    return price !== null && c > 0 && price < c
}

/** Fill helper for the grid: base price reduced by a percentage, rounded to 2 decimals. Never below 0.01. */
export function discountedPrice(base: number, percent: number): number | null {
    if (!(base > 0) || !Number.isFinite(percent) || percent < 0 || percent >= 100) return null
    const p = Math.round(base * (1 - percent / 100) * 100) / 100
    return p >= 0.01 ? p : null
}

/**
 * Read a package size like "5GB", "1.5 GB", "500MB" or "1TB" as gigabytes. Returns null for anything
 * else (for example "Unlimited"), so those packages are skipped instead of guessed. 1GB = 1000MB.
 */
export function parseSizeGb(size: string | null | undefined): number | null {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(tb|gb|g|mb|m)?\s*$/i.exec(size ?? '')
    if (!m) return null
    const n = Number(m[1])
    const unit = (m[2] ?? 'gb').toLowerCase()
    const gb = unit === 'tb' ? n * 1000 : unit === 'mb' || unit === 'm' ? n / 1000 : n
    return gb > 0 ? gb : null
}

/** Price for a package of `gb` gigabytes at `ratePerGb`, rounded to the nearest `step` (default 1 pesewa). */
export function priceFromRate(gb: number, ratePerGb: number, step = 0.01): number | null {
    if (!(gb > 0) || !(ratePerGb > 0) || !(step > 0)) return null
    const price = Math.round((gb * ratePerGb) / step) * step
    const rounded = Math.round(price * 100) / 100
    return rounded >= 0.01 && rounded <= MAX_PRICE ? rounded : null
}

export interface RateRow {
    id: string
    network: string
    size: string
    /** What is in the box now: a number, a typed string, or empty. */
    current: string | number | null | undefined
}

export interface RateOptions {
    ratePerGb: number
    step: number
    /** A network name, or 'all'. */
    network: string
    /** false = only fill packages with no price yet; true = replace prices that are already set. */
    overwrite: boolean
}

export interface RatePlan {
    /** packageId -> new price */
    updates: Record<string, number>
    /** Sizes that could not be read (for example "Unlimited"). */
    skippedUnreadable: string[]
    /** Already had a price and overwrite was off. */
    keptExisting: number
}

const isEmpty = (v: RateRow['current']) => v === null || v === undefined || String(v).trim() === ''

/** Pure: the prices a per-GB rate would set. Nothing is written; the caller shows it for review first. */
export function planRatePrices(rows: RateRow[], o: RateOptions): RatePlan {
    const plan: RatePlan = { updates: {}, skippedUnreadable: [], keptExisting: 0 }
    for (const r of rows) {
        if (o.network !== 'all' && r.network !== o.network) continue
        if (!o.overwrite && !isEmpty(r.current)) { plan.keptExisting++; continue }
        const gb = parseSizeGb(r.size)
        const price = gb === null ? null : priceFromRate(gb, o.ratePerGb, o.step)
        if (price === null) { plan.skippedUnreadable.push(`${r.network} ${r.size}`); continue }
        plan.updates[r.id] = price
    }
    return plan
}
