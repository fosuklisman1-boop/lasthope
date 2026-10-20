'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Loader2, Search, ScrollText, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface AuditEntry {
    id: string
    created_at: string
    actor_id: string | null
    actor_email: string | null
    actor_role: string | null
    action: string
    target_type: string | null
    target_id: string | null
    summary: string
    details: Record<string, unknown>
    reason: string | null
    ip: string | null
}

const FILTERS: { value: string; label: string }[] = [
    { value: 'all', label: 'All actions' },
    { value: 'wallet.*', label: 'Wallet adjustments' },
    { value: 'payment.*', label: 'Payment fixes' },
    { value: 'order.*', label: 'Orders and refunds' },
    { value: 'user.*', label: 'Users and roles' },
    { value: 'package.*', label: 'Packages' },
    { value: 'prices.*', label: 'Upgrade prices' },
    { value: 'settings.*', label: 'Settings' },
    { value: 'api_key.*', label: 'API keys' },
    { value: 'webhook.*', label: 'Webhook deliveries' },
    { value: 'withdrawal.*', label: 'Withdrawals' },
    { value: 'complaint.*', label: 'Complaints' },
    { value: 'announcement.*', label: 'Announcements' },
    { value: 'sms.*', label: 'SMS broadcasts' },
    { value: 'system.*', label: 'System' },
]

// One neon colour per area, so the log can be scanned by eye.
function areaColor(action: string): string {
    const area = action.split('.')[0]
    if (area === 'wallet' || area === 'withdrawal' || area === 'payment') return 'var(--neon-amber)'
    if (area === 'order' || area === 'complaint') return 'var(--neon-cyan)'
    if (area === 'user' || area === 'api_key' || area === 'webhook') return 'var(--neon-violet)'
    if (area === 'system') return 'var(--neon-coral)'
    return 'var(--neon-mint)'
}

function formatWhen(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Entry({ entry }: { entry: AuditEntry }) {
    const [open, setOpen] = useState(false)
    const hasDetails = !!entry.reason || Object.keys(entry.details || {}).length > 0

    return (
        <Card>
            <CardContent className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden
                        className="led mt-1.5 shrink-0"
                        style={{ '--led': areaColor(entry.action) } as React.CSSProperties}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                        <p className="font-medium leading-snug">{entry.summary}</p>
                        <p className="text-xs text-muted-foreground">
                            {entry.actor_email ?? 'Unknown admin'}
                            {entry.actor_role ? ` (${entry.actor_role})` : ''} · {formatWhen(entry.created_at)}
                            {entry.ip ? ` · ${entry.ip}` : ''}
                        </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">{entry.action}</Badge>
                </div>

                {hasDetails && (
                    <div>
                        <button
                            type="button"
                            onClick={() => setOpen(o => !o)}
                            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            aria-expanded={open}
                        >
                            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {open ? 'Hide details' : 'Show details'}
                        </button>
                        {open && (
                            <div className="mt-3 space-y-3">
                                {entry.reason && (
                                    <p className="neo-inset rounded-xl px-4 py-3 text-sm">
                                        <span className="text-muted-foreground">Reason: </span>
                                        {entry.reason}
                                    </p>
                                )}
                                {entry.target_type && (
                                    <p className="text-xs text-muted-foreground">
                                        Target: {entry.target_type}
                                        {entry.target_id ? <span className="font-mono"> {entry.target_id}</span> : null}
                                    </p>
                                )}
                                {Object.keys(entry.details || {}).length > 0 && (
                                    <pre className="neo-inset overflow-x-auto rounded-xl p-4 font-mono text-xs leading-relaxed text-foreground/90">
                                        {JSON.stringify(entry.details, null, 2)}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export default function AuditLogPage() {
    const [entries, setEntries] = useState<AuditEntry[]>([])
    const [total, setTotal] = useState(0)
    const [pageSize, setPageSize] = useState(25)
    const [page, setPage] = useState(1)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)

    const [action, setAction] = useState('all')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [search, setSearch] = useState('')
    const [q, setQ] = useState('')

    // Wait until typing pauses before querying.
    useEffect(() => {
        const t = setTimeout(() => { setQ(search); setPage(1) }, 350)
        return () => clearTimeout(t)
    }, [search])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(page) })
            if (action !== 'all') params.set('action', action)
            if (from) params.set('from', from)
            if (to) params.set('to', to)
            if (q) params.set('q', q)
            const res = await fetch(`/api/admin/audit-log?${params}`)
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load the audit log')
            setEntries(json.entries)
            setTotal(json.total)
            setPageSize(json.pageSize)
        } catch (e: any) {
            toast.error(e.message || 'Failed to load the audit log')
        } finally {
            setLoading(false)
        }
    }, [page, action, from, to, q])

    useEffect(() => { load() }, [load])

    const pages = Math.max(1, Math.ceil(total / pageSize))

    if (forbidden) {
        return (
            <Card className="mx-auto max-w-lg">
                <CardContent className="p-8 text-center text-muted-foreground">
                    Only admins can view the audit log.
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
                <p className="text-muted-foreground">A record of what admins changed, who did it and when.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_9rem_9rem]">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-10" placeholder="Search summary, admin email or ID" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={action} onValueChange={v => { setAction(v); setPage(1) }}>
                    <SelectTrigger aria-label="Filter by action"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Input type="date" aria-label="From date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} />
                <Input type="date" aria-label="To date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} />
            </div>

            {loading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
            ) : entries.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                        <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground">
                            <ScrollText className="h-5 w-5" />
                        </span>
                        <p className="font-medium">Nothing recorded yet</p>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            Admin actions such as refunds, wallet adjustments and role changes will appear here as they happen.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {entries.map(e => <Entry key={e.id} entry={e} />)}
                </div>
            )}

            {!loading && total > pageSize && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{total} entries · page {page} of {pages}</p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                            Next <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
