'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, RotateCw, Ban, ChevronDown, ChevronUp, Webhook, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface Delivery {
    id: string
    event: string
    order_id: string | null
    payload: Record<string, unknown>
    status: 'pending' | 'delivered' | 'failed'
    attempts: number
    next_attempt_at: string
    last_response_code: number | null
    created_at: string
    stopped: boolean
    key: { id: string; key_prefix: string; label: string | null; webhook_url: string | null; owner_email: string | null; user_id: string } | null
}

interface Counts { failed: number; pending: number; delivered: number }

function when(iso: string) {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Row({ d, busy, onAct }: { d: Delivery; busy: boolean; onAct: (id: string, action: 'retry' | 'stop') => void }) {
    const [open, setOpen] = useState(false)
    const variant = d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'failed' : 'pending'
    const label = d.status === 'failed' && d.stopped ? 'stopped' : d.status

    return (
        <Card>
            <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="font-mono text-[11px]">{d.event}</Badge>
                            <Badge variant={variant}>{label}</Badge>
                            {d.last_response_code !== null && (
                                <span className="text-xs text-muted-foreground">Response {d.last_response_code || 'none'}</span>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {d.key ? (
                                <>
                                    <span className="font-mono">{d.key.key_prefix}…</span>{d.key.label ? ` (${d.key.label})` : ''} ·{' '}
                                    <Link href={`/admin/users/${d.key.user_id}`} className="text-primary hover:underline">{d.key.owner_email ?? 'owner'}</Link>
                                </>
                            ) : 'Key removed'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {d.attempts >= 99 ? 'Stopped by an admin' : `${d.attempts} attempt${d.attempts === 1 ? '' : 's'}`} · Created {when(d.created_at)}
                            {d.status === 'pending' && ` · Next try ${when(d.next_attempt_at)}`}
                        </p>
                        {d.key?.webhook_url && <p className="break-all font-mono text-[11px] text-muted-foreground">{d.key.webhook_url}</p>}
                    </div>
                    {d.status !== 'delivered' && (
                        <div className="flex gap-2">
                            <Button size="sm" disabled={busy} onClick={() => onAct(d.id, 'retry')}>
                                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}Try again
                            </Button>
                            {!d.stopped && (
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAct(d.id, 'stop')}>
                                    <Ban className="mr-2 h-4 w-4" />Stop retrying
                                </Button>
                            )}
                        </div>
                    )}
                </div>
                <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {open ? 'Hide payload' : 'Show payload'}
                </button>
                {open && (
                    <pre className="neo-inset overflow-x-auto rounded-xl p-4 font-mono text-xs leading-relaxed">{JSON.stringify(d.payload, null, 2)}</pre>
                )}
            </CardContent>
        </Card>
    )
}

export default function WebhookMonitorPage() {
    const [status, setStatus] = useState('failed')
    const [page, setPage] = useState(1)
    const [rows, setRows] = useState<Delivery[]>([])
    const [counts, setCounts] = useState<Counts>({ failed: 0, pending: 0, delivered: 0 })
    const [total, setTotal] = useState(0)
    const [pageSize, setPageSize] = useState(20)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/webhooks?status=${status}&page=${page}`)
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load deliveries')
            setRows(json.deliveries); setCounts(json.counts); setTotal(json.total); setPageSize(json.pageSize)
        } catch (e: any) {
            toast.error(e.message || 'Failed to load deliveries')
        } finally {
            setLoading(false)
        }
    }, [status, page])

    useEffect(() => { load() }, [load])

    const act = async (id: string, action: 'retry' | 'stop') => {
        setBusyId(id)
        try {
            const res = await fetch('/api/admin/webhooks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed')
            toast.success(action === 'retry' ? 'Queued. It is sent within 5 minutes.' : 'Stopped')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusyId(null)
        }
    }

    if (forbidden) {
        return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can view webhook deliveries.</CardContent></Card>
    }

    const pages = Math.max(1, Math.ceil(total / pageSize))

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Webhook deliveries</h1>
                <p className="text-muted-foreground">Order updates sent to developers' servers. Retry the ones that failed.</p>
            </div>

            <Tabs value={status} onValueChange={v => { setStatus(v); setPage(1) }}>
                <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-2">
                    <TabsList className="w-max">
                        <TabsTrigger value="failed">Failed ({counts.failed})</TabsTrigger>
                        <TabsTrigger value="pending">Waiting ({counts.pending})</TabsTrigger>
                        <TabsTrigger value="delivered">Delivered ({counts.delivered})</TabsTrigger>
                        <TabsTrigger value="all">All</TabsTrigger>
                    </TabsList>
                </div>
            </Tabs>

            {loading ? (
                <div className="flex min-h-[240px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : rows.length === 0 ? (
                <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                    <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground"><Webhook className="h-5 w-5" /></span>
                    <p className="font-medium">{status === 'failed' ? 'No failed deliveries' : 'Nothing here'}</p>
                    <p className="max-w-sm text-sm text-muted-foreground">Deliveries appear when an order with a webhook-enabled API key changes status.</p>
                </CardContent></Card>
            ) : (
                <div className="space-y-3">{rows.map(d => <Row key={d.id} d={d} busy={busyId === d.id} onAct={act} />)}</div>
            )}

            {!loading && total > pageSize && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{total} deliveries · page {page} of {pages}</p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
                        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
                    </div>
                </div>
            )}
        </div>
    )
}
