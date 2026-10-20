import { describe, it, expect } from 'vitest'
import {
    evaluateAlerts, planAlertChanges, parseThresholds, DEFAULT_THRESHOLDS, THRESHOLD_KEYS,
    type AlertSnapshot,
} from './alerts'

const quiet: AlertSnapshot = {
    failedOrdersLastHour: 0, pendingWithdrawals: [], uncreditedPayments: 0, stuckPayments: 0, failedWebhooks24h: 0, problemJobs: [],
}
const T = DEFAULT_THRESHOLDS

describe('evaluateAlerts', () => {
    it('raises nothing when everything is quiet', () => {
        expect(evaluateAlerts(quiet, T)).toEqual([])
    })

    it('alerts on failed orders at the threshold, not below', () => {
        expect(evaluateAlerts({ ...quiet, failedOrdersLastHour: 4 }, T)).toEqual([])
        const [a] = evaluateAlerts({ ...quiet, failedOrdersLastHour: 5 }, T)
        expect(a).toMatchObject({ kind: 'failed_orders', severity: 'high', dedupeKey: 'failed-orders' })
    })

    it('alerts per large withdrawal with its own key', () => {
        const alerts = evaluateAlerts({
            ...quiet,
            pendingWithdrawals: [
                { id: 'w1', amount: 1500, userEmail: 'a@x.com' },
                { id: 'w2', amount: 200 },
                { id: 'w3', amount: 1000 },
            ],
        }, T)
        expect(alerts.map(a => a.dedupeKey)).toEqual(['withdrawal:w1', 'withdrawal:w3'])
        expect(alerts[0].body).toContain('a@x.com')
    })

    it('treats any uncredited payment as high severity', () => {
        const [a] = evaluateAlerts({ ...quiet, uncreditedPayments: 1 }, T)
        expect(a).toMatchObject({ kind: 'uncredited_payments', severity: 'high' })
        expect(a.body).toContain('1 completed payment has')
    })

    it('needs several stuck payments before alerting', () => {
        expect(evaluateAlerts({ ...quiet, stuckPayments: 2 }, T)).toEqual([])
        expect(evaluateAlerts({ ...quiet, stuckPayments: 3 }, T)[0]).toMatchObject({ kind: 'stuck_payments', severity: 'medium' })
    })

    it('alerts on webhook failures and on problem cron jobs', () => {
        const alerts = evaluateAlerts({
            ...quiet,
            failedWebhooks24h: 12,
            problemJobs: [
                { job: 'retry-webhooks', label: 'Retry webhooks', state: 'late', minutesSince: 40 },
                { job: 'alerts', label: 'Admin alerts', state: 'failing', minutesSince: 2 },
            ],
        }, T)
        expect(alerts.map(a => a.dedupeKey)).toEqual(['webhook-failures', 'cron:retry-webhooks', 'cron:alerts'])
        expect(alerts[1].title).toBe('Retry webhooks has stopped running')
        expect(alerts[2].title).toBe('Admin alerts is failing')
    })
})

describe('parseThresholds', () => {
    it('uses settings when valid and defaults otherwise', () => {
        const t = parseThresholds({ [THRESHOLD_KEYS.failedOrdersPerHour]: '10', [THRESHOLD_KEYS.largeWithdrawal]: 'junk', [THRESHOLD_KEYS.webhookFailures]: '0' })
        expect(t.failedOrdersPerHour).toBe(10)
        expect(t.largeWithdrawal).toBe(DEFAULT_THRESHOLDS.largeWithdrawal)
        expect(t.webhookFailures).toBe(DEFAULT_THRESHOLDS.webhookFailures)
    })
})

describe('planAlertChanges', () => {
    const NOW = new Date('2026-10-20T12:00:00Z')
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString()
    const cand = (key: string) => ({ kind: 'k', severity: 'high' as const, title: 't', body: 'b', dedupeKey: key })

    it('creates new alerts, resolves cleared ones, and touches ones still true', () => {
        const plan = planAlertChanges(
            [cand('a'), cand('b')],
            [{ id: '1', dedupeKey: 'b', notifiedAt: hoursAgo(1) }, { id: '2', dedupeKey: 'gone', notifiedAt: hoursAgo(1) }],
            NOW
        )
        expect(plan.create.map(c => c.dedupeKey)).toEqual(['a'])
        expect(plan.touch).toEqual(['1'])
        expect(plan.resolve).toEqual(['2'])
        expect(plan.renotify).toEqual([])
    })

    it('reminds again only after the quiet period', () => {
        const open = (h: number | null) => [{ id: '1', dedupeKey: 'a', notifiedAt: h === null ? null : hoursAgo(h) }]
        expect(planAlertChanges([cand('a')], open(5), NOW).renotify).toEqual([])
        expect(planAlertChanges([cand('a')], open(6), NOW).renotify).toEqual(['1'])
        expect(planAlertChanges([cand('a')], open(null), NOW).renotify).toEqual(['1'])
    })
})
