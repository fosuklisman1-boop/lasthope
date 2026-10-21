import { computeBalance, parseLimitSetting, effectiveLimit, type Balance } from '@/lib/shop-rules'

export const SHOP_SETTING_KEYS = {
    maxMarginPercent: 'shop_max_margin_percent',
    minWithdrawal: 'shop_min_withdrawal',
} as const

export interface ShopLimits {
    /** Platform-wide: the most a shop may charge above its owner's cost, in percent. null = no cap. */
    maxMarginPercent: number | null
    /** Platform-wide minimum withdrawal in GHS. null = none. */
    minWithdrawal: number | null
}

export interface ShopControls {
    suspended: boolean
    suspended_reason: string | null
    suspended_message: string | null
    suspended_at: string | null
    withdrawals_held: boolean
    hold_reason: string | null
    max_margin_percent: number | null
    min_withdrawal: number | null
    profile_locked: boolean
    notes: string | null
}

export const NO_CONTROLS: ShopControls = {
    suspended: false, suspended_reason: null, suspended_message: null, suspended_at: null,
    withdrawals_held: false, hold_reason: null, max_margin_percent: null, min_withdrawal: null,
    profile_locked: false, notes: null,
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export const DEFAULT_SUSPENSION_MESSAGE = 'This shop is temporarily unavailable.'

/** Platform-wide shop limits from admin_settings. A read failure means "no limit" is NOT assumed: it throws. */
export async function loadShopLimits(db: any): Promise<ShopLimits> {
    const { data, error } = await db.from('admin_settings').select('key, value').in('key', Object.values(SHOP_SETTING_KEYS))
    if (error) throw new Error(`shop limits: ${error.message}`)
    const map: Record<string, string> = {}
    for (const r of data ?? []) map[r.key] = r.value
    return {
        maxMarginPercent: parseLimitSetting(map[SHOP_SETTING_KEYS.maxMarginPercent]),
        minWithdrawal: parseLimitSetting(map[SHOP_SETTING_KEYS.minWithdrawal]),
    }
}

/** A shop's admin state. A shop with no row has no restrictions. */
export async function loadShopControls(db: any, shopId: string): Promise<ShopControls> {
    const { data, error } = await db.from('shop_controls').select('*').eq('shop_id', shopId).maybeSingle()
    if (error) throw new Error(`shop controls: ${error.message}`)
    if (!data) return { ...NO_CONTROLS }
    return {
        suspended: !!data.suspended,
        suspended_reason: data.suspended_reason ?? null,
        suspended_message: data.suspended_message ?? null,
        suspended_at: data.suspended_at ?? null,
        withdrawals_held: !!data.withdrawals_held,
        hold_reason: data.hold_reason ?? null,
        max_margin_percent: num(data.max_margin_percent),
        min_withdrawal: num(data.min_withdrawal),
        profile_locked: !!data.profile_locked,
        notes: data.notes ?? null,
    }
}

/** The limits that actually apply to one shop: its own override, else the platform's. */
export function limitsFor(controls: ShopControls, platform: ShopLimits): ShopLimits {
    return {
        maxMarginPercent: effectiveLimit(controls.max_margin_percent, platform.maxMarginPercent),
        minWithdrawal: effectiveLimit(controls.min_withdrawal, platform.minWithdrawal),
    }
}

export async function loadBlockedPackageIds(db: any, shopId: string): Promise<Set<string>> {
    const { data, error } = await db.from('shop_blocked_packages').select('package_id').eq('shop_id', shopId)
    if (error) throw new Error(`blocked packages: ${error.message}`)
    return new Set<string>((data ?? []).map((r: any) => r.package_id))
}

/** Profit, ledger and withdrawals for one shop and its owner. */
export async function loadShopBalance(db: any, shopId: string, ownerId: string): Promise<Balance> {
    const [parts, withdrawals] = await Promise.all([
        db.rpc('shop_profit_parts', { p_shop_id: shopId }).single(),
        db.from('withdrawals').select('amount, status').eq('user_id', ownerId).in('status', ['approved', 'pending']),
    ])
    if (parts.error) throw new Error(`shop profit: ${parts.error.message}`)
    if (withdrawals.error) throw new Error(`withdrawals: ${withdrawals.error.message}`)

    const sum = (status: string) =>
        (withdrawals.data ?? []).filter((w: any) => w.status === status).reduce((acc: number, w: any) => acc + (Number(w.amount) || 0), 0)

    return computeBalance({
        orderProfit: Number(parts.data?.order_profit) || 0,
        ledger: Number(parts.data?.ledger) || 0,
        withdrawn: sum('approved'),
        pending: sum('pending'),
    })
}
