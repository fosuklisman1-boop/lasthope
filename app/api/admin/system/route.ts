import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { CRON_JOBS, freshness, type CronRunRow } from '@/lib/cron-runs'
import { MAINTENANCE_KEY, clearMaintenanceCache } from '@/lib/maintenance'
import { runAlertChecks } from '@/lib/alert-runner'
import { parseThresholds, THRESHOLD_KEYS } from '@/lib/alerts'

export const dynamic = 'force-dynamic'

export async function GET() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const [settingsRes, cronRes, openRes, recentRes] = await Promise.all([
        db.from('admin_settings').select('key, value').in('key', [MAINTENANCE_KEY, ...Object.values(THRESHOLD_KEYS)]),
        db.from('cron_runs').select('*'),
        db.from('admin_alerts').select('id, kind, severity, title, body, created_at, last_seen_at').is('resolved_at', null).order('created_at', { ascending: false }),
        db.from('admin_alerts').select('id, kind, severity, title, created_at, resolved_at').not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(10),
    ])

    const settings: Record<string, string> = {}
    for (const r of settingsRes.data ?? []) settings[r.key] = r.value

    const runs = new Map<string, CronRunRow>((cronRes.data ?? []).map((r: CronRunRow) => [r.job, r]))
    const now = new Date()
    const jobs = CRON_JOBS.map(cfg => {
        const row = runs.get(cfg.job)
        const f = freshness(cfg, row, now)
        return {
            ...cfg,
            state: f.state,
            minutesSince: f.minutesSince,
            lastFinishedAt: row?.last_finished_at ?? null,
            lastStatus: row?.last_status ?? null,
            lastError: row?.last_error ?? null,
            lastDurationMs: row?.last_duration_ms ?? null,
            runsTotal: Number(row?.runs_total ?? 0),
        }
    })

    return NextResponse.json({
        paymentMaintenance: settings[MAINTENANCE_KEY] === 'true',
        envForcesMaintenance: process.env.NEXT_PUBLIC_PAYMENT_MAINTENANCE_MODE === 'true',
        thresholds: parseThresholds(settings),
        jobs,
        alerts: openRes.data ?? [],
        recentlyResolved: recentRes.data ?? [],
    })
}

// PUT { paymentMaintenance: boolean, reason } flips the payments switch.
export async function PUT(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    if (typeof body.paymentMaintenance !== 'boolean') {
        return NextResponse.json({ error: 'paymentMaintenance (true or false) is required' }, { status: 400 })
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) {
        return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })
    }

    const { error } = await (auth.supabase as any)
        .from('admin_settings')
        .upsert({ key: MAINTENANCE_KEY, value: String(body.paymentMaintenance) })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clearMaintenanceCache()

    await logAudit(auth, {
        action: 'system.maintenance',
        targetType: 'settings',
        targetId: MAINTENANCE_KEY,
        summary: body.paymentMaintenance ? 'Paused payments (maintenance mode on)' : 'Resumed payments (maintenance mode off)',
        details: { paymentMaintenance: body.paymentMaintenance },
        reason,
    }, request)

    return NextResponse.json({ success: true, paymentMaintenance: body.paymentMaintenance })
}

// POST { action: 'run_alerts' } runs the alert checks now.
export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    if (body.action !== 'run_alerts') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

    try {
        return NextResponse.json(await runAlertChecks())
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'The alert check failed' }, { status: 500 })
    }
}
