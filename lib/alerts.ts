export interface AlertSnapshot {
    failedOrdersLastHour: number
    pendingWithdrawals: { id: string; amount: number; userEmail?: string | null }[]
    uncreditedPayments: number
    stuckPayments: number
    failedWebhooks24h: number
    problemJobs: { job: string; label: string; state: 'late' | 'failing'; minutesSince: number | null }[]
}

export interface AlertThresholds {
    failedOrdersPerHour: number
    largeWithdrawal: number
    webhookFailures: number
    stuckPayments: number
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
    failedOrdersPerHour: 5,
    largeWithdrawal: 1000,
    webhookFailures: 10,
    stuckPayments: 3,
}

/** admin_settings keys that tune the alerts. */
export const THRESHOLD_KEYS = {
    failedOrdersPerHour: 'alert_failed_orders_per_hour',
    largeWithdrawal: 'alert_large_withdrawal',
    webhookFailures: 'alert_webhook_failures',
    stuckPayments: 'alert_stuck_payments',
} as const

export interface AlertCandidate {
    kind: string
    severity: 'high' | 'medium'
    title: string
    body: string
    dedupeKey: string
}

export function parseThresholds(settings: Record<string, string | undefined>): AlertThresholds {
    const read = (key: string, fallback: number) => {
        const n = parseFloat(settings[key] ?? '')
        return Number.isFinite(n) && n > 0 ? n : fallback
    }
    return {
        failedOrdersPerHour: read(THRESHOLD_KEYS.failedOrdersPerHour, DEFAULT_THRESHOLDS.failedOrdersPerHour),
        largeWithdrawal: read(THRESHOLD_KEYS.largeWithdrawal, DEFAULT_THRESHOLDS.largeWithdrawal),
        webhookFailures: read(THRESHOLD_KEYS.webhookFailures, DEFAULT_THRESHOLDS.webhookFailures),
        stuckPayments: read(THRESHOLD_KEYS.stuckPayments, DEFAULT_THRESHOLDS.stuckPayments),
    }
}

const ghs = (n: number) => `GHS ${n.toFixed(2)}`

/** Pure: which alerts apply to this snapshot. */
export function evaluateAlerts(s: AlertSnapshot, t: AlertThresholds): AlertCandidate[] {
    const out: AlertCandidate[] = []

    if (s.failedOrdersLastHour >= t.failedOrdersPerHour) {
        out.push({
            kind: 'failed_orders', severity: 'high', dedupeKey: 'failed-orders',
            title: 'Failed orders are piling up',
            body: `${s.failedOrdersLastHour} orders failed in the last hour (alert at ${t.failedOrdersPerHour}). Check the provider and recent orders.`,
        })
    }

    for (const w of s.pendingWithdrawals) {
        if (w.amount >= t.largeWithdrawal) {
            out.push({
                kind: 'large_withdrawal', severity: 'high', dedupeKey: `withdrawal:${w.id}`,
                title: `Large withdrawal waiting: ${ghs(w.amount)}`,
                body: `${w.userEmail ?? 'A user'} requested ${ghs(w.amount)}. It needs approval or rejection.`,
            })
        }
    }

    if (s.uncreditedPayments > 0) {
        out.push({
            kind: 'uncredited_payments', severity: 'high', dedupeKey: 'uncredited-payments',
            title: 'Paid top-ups were not credited',
            body: `${s.uncreditedPayments} completed payment${s.uncreditedPayments === 1 ? ' has' : 's have'} no wallet credit. Open Reconcile to fix ${s.uncreditedPayments === 1 ? 'it' : 'them'}.`,
        })
    }

    if (s.stuckPayments >= t.stuckPayments) {
        out.push({
            kind: 'stuck_payments', severity: 'medium', dedupeKey: 'stuck-payments',
            title: 'Payments are stuck pending',
            body: `${s.stuckPayments} payments have been pending for over an hour. Open Reconcile and check them with Paystack.`,
        })
    }

    if (s.failedWebhooks24h >= t.webhookFailures) {
        out.push({
            kind: 'webhook_failures', severity: 'medium', dedupeKey: 'webhook-failures',
            title: 'Webhook deliveries are failing',
            body: `${s.failedWebhooks24h} developer webhook deliveries failed in the last day. Open Webhooks to review them.`,
        })
    }

    for (const j of s.problemJobs) {
        out.push({
            kind: 'cron_problem', severity: 'medium', dedupeKey: `cron:${j.job}`,
            title: j.state === 'failing' ? `${j.label} is failing` : `${j.label} has stopped running`,
            body: j.state === 'failing'
                ? `The last run of "${j.label}" ended in an error. Check the System page for details.`
                : `"${j.label}" last ran ${j.minutesSince ?? '?'} minutes ago. Check that the external scheduler is still calling it.`,
        })
    }

    return out
}

export interface OpenAlert {
    id: string
    dedupeKey: string
    notifiedAt: string | null
}

export interface AlertPlan {
    /** New alerts to store and announce. */
    create: AlertCandidate[]
    /** Still-open alerts seen again (refresh last_seen_at). */
    touch: string[]
    /** Open alerts that have gone unannounced for a while: remind admins. */
    renotify: string[]
    /** Open alerts whose condition has cleared. */
    resolve: string[]
}

/** Pure: reconcile what is true now with what is already open. */
export function planAlertChanges(candidates: AlertCandidate[], open: OpenAlert[], now: Date = new Date(), renotifyHours = 6): AlertPlan {
    const openByKey = new Map(open.map(o => [o.dedupeKey, o]))
    const currentKeys = new Set(candidates.map(c => c.dedupeKey))
    const plan: AlertPlan = { create: [], touch: [], renotify: [], resolve: [] }

    for (const c of candidates) {
        const existing = openByKey.get(c.dedupeKey)
        if (!existing) { plan.create.push(c); continue }
        plan.touch.push(existing.id)
        const last = existing.notifiedAt ? new Date(existing.notifiedAt).getTime() : 0
        if (now.getTime() - last >= renotifyHours * 3600000) plan.renotify.push(existing.id)
    }
    for (const o of open) if (!currentKeys.has(o.dedupeKey)) plan.resolve.push(o.id)
    return plan
}
