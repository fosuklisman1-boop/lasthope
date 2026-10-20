export const DEFAULT_CONFIRM_ABOVE = 500
export const MAX_ADJUSTMENT = 1_000_000
export const MIN_REASON = 5
export const MAX_REASON = 300

export type AdjustmentCheck =
    | { ok: true; amount: number; reason: string }
    | { ok: false; code: 'invalid_amount' | 'reason_required' | 'needs_confirmation'; error: string }

/**
 * Rules for an admin wallet credit or debit.
 * - the amount must be a positive number with at most two decimals
 * - a reason is required so the audit log can say why money moved
 * - amounts above the confirmation threshold need an explicit second confirmation
 */
export function checkAdjustment(input: {
    amount: unknown
    reason: unknown
    confirmLarge?: boolean
    confirmAbove?: number
}): AdjustmentCheck {
    const amount = typeof input.amount === 'number' ? input.amount : parseFloat(String(input.amount))
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ADJUSTMENT) {
        return { ok: false, code: 'invalid_amount', error: `Enter an amount between 0.01 and ${MAX_ADJUSTMENT.toLocaleString('en-GB')}` }
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        return { ok: false, code: 'invalid_amount', error: 'Use at most two decimal places' }
    }

    const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
    if (reason.length < MIN_REASON) {
        return { ok: false, code: 'reason_required', error: `Give a reason of at least ${MIN_REASON} characters` }
    }

    const confirmAbove = input.confirmAbove ?? DEFAULT_CONFIRM_ABOVE
    if (amount > confirmAbove && !input.confirmLarge) {
        return {
            ok: false,
            code: 'needs_confirmation',
            error: `Amounts above GHS ${confirmAbove.toLocaleString('en-GB')} need a second confirmation`,
        }
    }

    return { ok: true, amount: Math.round(amount * 100) / 100, reason: reason.slice(0, MAX_REASON) }
}

/** Read the confirmation threshold from admin_settings; fall back to the default on junk values. */
export function parseConfirmAbove(value: string | undefined | null): number {
    const n = parseFloat(value ?? '')
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONFIRM_ABOVE
}
