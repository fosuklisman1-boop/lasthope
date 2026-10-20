'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Loader2, BellRing, CheckCircle2, Timer } from 'lucide-react'
import { toast } from 'sonner'

interface Job {
    job: string
    label: string
    everyMinutes: number
    state: 'ok' | 'late' | 'failing' | 'never'
    minutesSince: number | null
    lastFinishedAt: string | null
    lastStatus: 'ok' | 'error' | null
    lastError: string | null
    lastDurationMs: number | null
    runsTotal: number
}
interface Alert { id: string; kind: string; severity: 'high' | 'medium'; title: string; body: string; created_at: string; last_seen_at: string }
interface Resolved { id: string; severity: 'high' | 'medium'; title: string; created_at: string; resolved_at: string }
interface Thresholds { failedOrdersPerHour: number; largeWithdrawal: number; webhookFailures: number; stuckPayments: number }
interface SystemData {
    paymentMaintenance: boolean
    envForcesMaintenance: boolean
    thresholds: Thresholds
    jobs: Job[]
    alerts: Alert[]
    recentlyResolved: Resolved[]
}

const THRESHOLD_FIELDS: { key: keyof Thresholds; setting: string; label: string; hint: string }[] = [
    { key: 'failedOrdersPerHour', setting: 'alert_failed_orders_per_hour', label: 'Failed orders in an hour', hint: 'Alert at or above this many' },
    { key: 'largeWithdrawal', setting: 'alert_large_withdrawal', label: 'Large withdrawal (GHS)', hint: 'Alert for requests at or above this' },
    { key: 'webhookFailures', setting: 'alert_webhook_failures', label: 'Failed webhooks in a day', hint: 'Alert at or above this many' },
    { key: 'stuckPayments', setting: 'alert_stuck_payments', label: 'Payments stuck pending', hint: 'Alert at or above this many' },
]

function every(min: number) {
    if (min >= 1440) return 'daily'
    if (min >= 60) return `every ${Math.round(min / 60)} h`
    return `every ${min} min`
}

function ago(min: number | null) {
    if (min === null) return 'never'
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    if (min < 2880) return `${Math.round(min / 60)} h ago`
    return `${Math.round(min / 1440)} days ago`
}

const STATE_BADGE: Record<Job['state'], { variant: 'success' | 'pending' | 'failed' | 'secondary'; label: string }> = {
    ok: { variant: 'success', label: 'running' },
    late: { variant: 'pending', label: 'late' },
    failing: { variant: 'failed', label: 'failing' },
    never: { variant: 'secondary', label: 'never ran' },
}

export default function SystemPage() {
    const [data, setData] = useState<SystemData | null>(null)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)
    const [switching, setSwitching] = useState(false)
    const [running, setRunning] = useState(false)
    const [draft, setDraft] = useState<Record<string, string>>({})
    const [savingThresholds, setSavingThresholds] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/system')
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load system status')
            setData(json)
            setDraft(Object.fromEntries(THRESHOLD_FIELDS.map(f => [f.setting, String(json.thresholds[f.key])])))
        } catch (e: any) {
            toast.error(e.message || 'Failed to load system status')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const toggleMaintenance = async (next: boolean) => {
        const reason = window.prompt(
            next
                ? 'Pause all payments? Top-ups, guest checkout and upgrades stop until you resume.\n\nReason (required):'
                : 'Resume payments?\n\nReason (required):'
        )
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        setSwitching(true)
        try {
            const res = await fetch('/api/admin/system', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentMaintenance: next, reason: reason.trim() }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to change the switch')
            toast.success(next ? 'Payments paused' : 'Payments resumed')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSwitching(false)
        }
    }

    const runAlerts = async () => {
        setRunning(true)
        try {
            const res = await fetch('/api/admin/system', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run_alerts' }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'The check failed')
            toast.success(`Checked. ${json.open} open, ${json.created} new, ${json.resolved} cleared.`)
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setRunning(false)
        }
    }

    const saveThresholds = async () => {
        setSavingThresholds(true)
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: THRESHOLD_FIELDS.map(f => ({ key: f.setting, value: draft[f.setting] })) }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save')
            toast.success('Alert limits saved')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSavingThresholds(false)
        }
    }

    if (forbidden) {
        return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can open the System page.</CardContent></Card>
    }
    if (loading || !data) {
        return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    }

    return (
        <div className="dev-page mx-auto max-w-4xl space-y-8">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">System</h1>
                <p className="text-muted-foreground">Payment switch, alerts and the health of scheduled jobs.</p>
            </div>

            {/* Payments switch */}
            <Card className={data.paymentMaintenance ? 'neon-edge-amber' : ''}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
                    <div className="max-w-xl space-y-1">
                        <h2 className="text-lg font-semibold">Pause payments</h2>
                        <p className="text-sm text-muted-foreground">
                            While paused, wallet top-ups, guest checkout and tier upgrades show a maintenance message and nothing is charged.
                            Existing wallet balances still work for orders.
                        </p>
                        {data.envForcesMaintenance && (
                            <p className="text-sm text-[hsl(var(--neon-amber))]">
                                The server environment also forces maintenance on. Remove NEXT_PUBLIC_PAYMENT_MAINTENANCE_MODE to control it here.
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant={data.paymentMaintenance ? 'pending' : 'success'}>{data.paymentMaintenance ? 'Paused' : 'Payments on'}</Badge>
                        <Switch checked={data.paymentMaintenance} disabled={switching} onCheckedChange={toggleMaintenance} aria-label="Pause payments" />
                    </div>
                </CardContent>
            </Card>

            {/* Alerts */}
            <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">Alerts</h2>
                    <Button variant="outline" size="sm" onClick={runAlerts} disabled={running}>
                        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}Check now
                    </Button>
                </div>

                {data.alerts.length === 0 ? (
                    <Card><CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-5 w-5 text-[hsl(var(--neon-mint))]" />No open alerts.
                    </CardContent></Card>
                ) : data.alerts.map(a => (
                    <Card key={a.id}><CardContent className="space-y-1 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={a.severity === 'high' ? 'failed' : 'pending'}>{a.severity === 'high' ? 'Needs action' : 'Heads up'}</Badge>
                            <span className="font-medium">{a.title}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{a.body}</p>
                        <p className="text-xs text-muted-foreground">Since {new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    </CardContent></Card>
                ))}

                {data.recentlyResolved.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Recently cleared: {data.recentlyResolved.slice(0, 5).map(r => r.title).join(' · ')}
                    </p>
                )}

                <Card><CardContent className="space-y-4 p-5">
                    <div>
                        <h3 className="font-semibold">When to alert</h3>
                        <p className="text-sm text-muted-foreground">Admins get an email, and a text for urgent ones. The same alert is repeated at most every 6 hours.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                        {THRESHOLD_FIELDS.map(f => (
                            <div key={f.setting} className="space-y-1.5">
                                <Label htmlFor={f.setting}>{f.label}</Label>
                                <Input id={f.setting} type="number" min={1} value={draft[f.setting] ?? ''} onChange={e => setDraft(d => ({ ...d, [f.setting]: e.target.value }))} />
                                <p className="text-xs text-muted-foreground">{f.hint}</p>
                            </div>
                        ))}
                    </div>
                    <Button onClick={saveThresholds} disabled={savingThresholds}>
                        {savingThresholds && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save limits
                    </Button>
                </CardContent></Card>
            </section>

            {/* Scheduled jobs */}
            <section className="space-y-4">
                <h2 className="text-xl font-semibold">Scheduled jobs</h2>
                <p className="text-sm text-muted-foreground">
                    Each job is called by your external scheduler at /api/cron/&lt;job&gt;. A job is late once it misses about two runs.
                </p>
                <div className="space-y-3">
                    {data.jobs.map(j => (
                        <Card key={j.job}><CardContent className="space-y-1 p-4 sm:p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Timer className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">{j.label}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{j.job}</span>
                                </div>
                                <Badge variant={STATE_BADGE[j.state].variant}>{STATE_BADGE[j.state].label}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Expected {every(j.everyMinutes)} · Last run {ago(j.minutesSince)}
                                {j.lastDurationMs !== null && ` · took ${j.lastDurationMs} ms`} · {j.runsTotal} run{j.runsTotal === 1 ? '' : 's'} so far
                            </p>
                            {j.lastError && <p className="text-sm text-[hsl(var(--neon-coral))]">Last error: {j.lastError}</p>}
                        </CardContent></Card>
                    ))}
                </div>
            </section>
        </div>
    )
}
