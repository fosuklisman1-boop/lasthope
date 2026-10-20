import { createServerClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email-service'
import { sendSMS } from '@/lib/sms-service'
import { CRON_JOBS, freshness, type CronRunRow } from '@/lib/cron-runs'
import { loadReconciliation } from '@/lib/reconciliation-data'
import {
    evaluateAlerts, planAlertChanges, parseThresholds, THRESHOLD_KEYS,
    type AlertCandidate, type AlertSnapshot,
} from '@/lib/alerts'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export interface AlertRunResult {
    created: number
    resolved: number
    notified: number
    open: number
}

async function buildSnapshot(db: any, now: Date): Promise<{ snapshot: AlertSnapshot; settings: Record<string, string> }> {
    const hourAgo = new Date(now.getTime() - 3600000).toISOString()
    const dayAgo = new Date(now.getTime() - 86400000).toISOString()

    const [settingsRes, failedOrders, withdrawalsRes, recon, failedHooks, cronRes] = await Promise.all([
        db.from('admin_settings').select('key, value').in('key', Object.values(THRESHOLD_KEYS)),
        db.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('updated_at', hourAgo),
        db.from('withdrawals').select('id, amount, user_id').eq('status', 'pending'),
        loadReconciliation(db, 7).catch(() => null),
        db.from('api_webhook_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('updated_at', dayAgo),
        db.from('cron_runs').select('*'),
    ])

    const settings: Record<string, string> = {}
    for (const r of settingsRes.data ?? []) settings[r.key] = r.value

    const withdrawals = (withdrawalsRes.data ?? []) as { id: string; amount: number | string; user_id: string }[]
    const emails: Record<string, string> = {}
    if (withdrawals.length) {
        const { data: users } = await db.from('users').select('id, email').in('id', withdrawals.map(w => w.user_id))
        for (const u of users ?? []) emails[u.id] = u.email
    }

    const runs = new Map<string, CronRunRow>((cronRes.data ?? []).map((r: CronRunRow) => [r.job, r]))
    const problemJobs: AlertSnapshot['problemJobs'] = []
    for (const cfg of CRON_JOBS) {
        if (cfg.job === 'alerts') continue // this run is the proof it is alive
        const f = freshness(cfg, runs.get(cfg.job), now)
        if (f.state === 'late' || f.state === 'failing') {
            problemJobs.push({ job: cfg.job, label: cfg.label, state: f.state, minutesSince: f.minutesSince })
        }
    }

    return {
        settings,
        snapshot: {
            failedOrdersLastHour: failedOrders.count ?? 0,
            pendingWithdrawals: withdrawals.map(w => ({ id: w.id, amount: Number(w.amount), userEmail: emails[w.user_id] ?? null })),
            uncreditedPayments: recon ? recon.issues.filter(i => i.kind === 'completed_not_credited').length : 0,
            stuckPayments: recon ? recon.issues.filter(i => i.kind === 'stuck_pending').length : 0,
            failedWebhooks24h: failedHooks.count ?? 0,
            problemJobs,
        },
    }
}

async function notifyAdmins(db: any, alerts: AlertCandidate[]): Promise<number> {
    if (alerts.length === 0) return 0
    const { data: admins } = await db.from('users').select('email, phone_number').eq('role', 'admin').eq('status', 'active')
    if (!admins || admins.length === 0) return 0

    const high = alerts.filter(a => a.severity === 'high')
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
        <h2 style="margin:0 0 12px">LASTHOPE admin alerts</h2>
        ${alerts.map(a => `<div style="border-left:4px solid ${a.severity === 'high' ? '#e11d48' : '#f59e0b'};padding:8px 12px;margin:10px 0;background:#f8fafc">
            <strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(a.body)}</div>`).join('')}
        <p style="color:#64748b;font-size:13px">Open the admin area (System, Reconcile or Webhooks) to act on these.</p></div>`

    let sent = 0
    for (const admin of admins) {
        if (admin.email) {
            const r = await sendEmail({ to: admin.email, subject: `LASTHOPE alert: ${alerts[0].title}${alerts.length > 1 ? ` (+${alerts.length - 1} more)` : ''}`, htmlContent: html })
            if (r.success) sent++
        }
        // Texts are for the serious ones only.
        if (high.length > 0 && admin.phone_number) {
            await sendSMS({ recipient: admin.phone_number, message: `LASTHOPE alert: ${high[0].title}${high.length > 1 ? ` (+${high.length - 1} more)` : ''}. Open the admin area.` })
                .catch(() => undefined)
        }
    }
    return sent
}

/** Evaluate every alert rule, store the changes and tell the admins about anything new. */
export async function runAlertChecks(now: Date = new Date()): Promise<AlertRunResult> {
    const db = createServerClient() as any
    const { snapshot, settings } = await buildSnapshot(db, now)
    const candidates = evaluateAlerts(snapshot, parseThresholds(settings))

    const { data: openRows } = await db.from('admin_alerts').select('id, dedupe_key, notified_at').is('resolved_at', null)
    const open = (openRows ?? []).map((r: any) => ({ id: r.id, dedupeKey: r.dedupe_key, notifiedAt: r.notified_at }))
    const plan = planAlertChanges(candidates, open, now)

    const nowIso = now.toISOString()
    const toAnnounce: AlertCandidate[] = []

    for (const c of plan.create) {
        const { error } = await db.from('admin_alerts').insert({
            kind: c.kind, severity: c.severity, title: c.title, body: c.body, dedupe_key: c.dedupeKey,
        })
        // A parallel run may have just opened the same alert; the unique index makes that a no-op.
        if (!error) toAnnounce.push(c)
    }

    if (plan.touch.length) {
        await db.from('admin_alerts').update({ last_seen_at: nowIso }).in('id', plan.touch)
    }
    if (plan.resolve.length) {
        await db.from('admin_alerts').update({ resolved_at: nowIso }).in('id', plan.resolve)
    }

    const remindIds = new Set(plan.renotify)
    for (const c of candidates) {
        const row = open.find((o: any) => o.dedupeKey === c.dedupeKey)
        if (row && remindIds.has(row.id)) toAnnounce.push(c)
    }

    const notified = await notifyAdmins(db, toAnnounce)
    if (toAnnounce.length) {
        const keys = toAnnounce.map(a => a.dedupeKey)
        await db.from('admin_alerts').update({ notified_at: nowIso }).in('dedupe_key', keys).is('resolved_at', null)
    }

    return { created: plan.create.length, resolved: plan.resolve.length, notified, open: candidates.length }
}
