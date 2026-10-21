'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { parsePrice, belowCost } from '@/lib/price-tables'
import { RateTool } from '@/components/admin/rate-tool'

interface Row {
    id: string
    network: string
    size: string
    is_available: boolean
    base: number
    cost: number
    rolePrice: number
    customPrice: number | null
    effective: number
    reason: string | null
}

/** Prices set for one customer. They beat the price table of the customer's role. */
export function CustomerPrices({ userId, roleLabel }: { userId: string; roleLabel: string }) {
    const [rows, setRows] = useState<Row[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [typed, setTyped] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/users/${userId}/prices`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load prices')
            setRows(json.packages)
            setTyped({})
            setError(null)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => { load() }, [load])

    const send = async (r: Row, price: number | null) => {
        const verb = price === null ? `Remove the custom price for ${r.network} ${r.size}?` : `Set ${r.network} ${r.size} to ${formatCurrency(price)} for this customer?${belowCost(price, r.cost) ? `\n\nThis is below the cost of ${formatCurrency(r.cost)}.` : ''}`
        const reason = window.prompt(`${verb}\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')

        setBusy(r.id)
        try {
            const res = await fetch(`/api/admin/users/${userId}/prices`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packageId: r.id, price, reason: reason.trim() }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the price')
            toast.success(price === null ? 'Custom price removed' : 'Custom price saved')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    // Typed values that differ from what is saved: a price to set, or null to remove one.
    const pending = rows.flatMap(r => {
        if (!(r.id in typed)) return []
        const v = typed[r.id].trim()
        const saved = r.customPrice === null ? '' : String(r.customPrice)
        if (v === saved || (v !== '' && Number(v) === r.customPrice)) return []
        if (v === '') return [{ row: r, price: null as number | null, ok: true }]
        const p = parsePrice(v)
        return [{ row: r, price: p.ok ? p.price : null, ok: p.ok }]
    })
    const hasInvalid = pending.some(p => !p.ok)
    const lossCount = pending.filter(p => p.ok && belowCost(p.price, p.row.cost)).length

    const saveAll = async () => {
        const reason = window.prompt(`Save ${pending.length} custom price change${pending.length === 1 ? '' : 's'} for this customer?${lossCount ? `\n\n${lossCount} below cost.` : ''}\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        setBusy('all')
        try {
            const res = await fetch(`/api/admin/users/${userId}/prices`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: pending.map(p => ({ packageId: p.row.id, price: p.price })), reason: reason.trim() }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the prices')
            toast.success(`Saved ${json.changed} change${json.changed === 1 ? '' : 's'}`)
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    if (loading) return <div className="flex min-h-[160px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
    if (error) return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{error}</CardContent></Card>

    const custom = rows.filter(r => r.customPrice !== null).length

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                This customer normally pays the {roleLabel} price. Set a price below to charge them something different for one package.
                {custom > 0 ? ` ${custom} custom price${custom === 1 ? '' : 's'} set.` : ''}
            </p>
            <Card><CardContent className="p-4">
                <RateTool
                    noun="custom price"
                    rows={rows.map(r => ({ id: r.id, network: r.network, size: r.size, current: r.id in typed ? typed[r.id] : r.customPrice }))}
                    onApply={(plan) => setTyped(t => ({ ...t, ...Object.fromEntries(Object.entries(plan.updates).map(([pid, p]) => [pid, String(p)])) }))}
                />
            </CardContent></Card>
            <Card><CardContent className="p-2 sm:p-4">
                {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">There are no packages yet.</p> : (
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Package</TableHead>
                            <TableHead className="text-right">{roleLabel} pays</TableHead>
                            <TableHead className="w-56">This customer pays</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {rows.map(r => {
                                const v = r.id in typed ? typed[r.id] : r.customPrice === null ? '' : String(r.customPrice)
                                const parsed = v.trim() === '' ? null : parsePrice(v)
                                const bad = parsed !== null && !parsed.ok
                                const num = parsed && parsed.ok ? parsed.price : null
                                const dirty = r.id in typed && v.trim() !== (r.customPrice === null ? '' : String(r.customPrice)) && num !== r.customPrice
                                return (
                                    <TableRow key={r.id}>
                                        <TableCell className="font-medium">
                                            {r.network} {r.size}
                                            {r.customPrice !== null && <Badge variant="processing" className="ml-2">Custom</Badge>}
                                            {!r.is_available && <Badge variant="secondary" className="ml-2">Hidden</Badge>}
                                            {r.reason && r.customPrice !== null && <p className="text-xs font-normal text-muted-foreground">{r.reason}</p>}
                                        </TableCell>
                                        <TableCell className="text-right">{formatCurrency(r.rolePrice)}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Input type="number" inputMode="decimal" min={0} step="0.01" value={v} placeholder={r.rolePrice.toFixed(2)}
                                                    onChange={e => setTyped(t => ({ ...t, [r.id]: e.target.value }))} aria-label={`Custom price for ${r.network} ${r.size}`} aria-invalid={bad}
                                                    className={bad ? 'ring-1 ring-[hsl(var(--neon-coral))]' : ''} />
                                                {!bad && belowCost(num, r.cost) && <span title={`Below the cost of ${formatCurrency(r.cost)}`} className="text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" /><span className="sr-only">Below cost</span></span>}
                                                {dirty && num !== null && <Button size="sm" disabled={busy === r.id} onClick={() => send(r, num)}>{busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>}
                                                {!dirty && r.customPrice !== null && <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => send(r, null)}>Remove</Button>}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent></Card>

            {pending.length > 0 && (
                <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-card/95 p-3 shadow-[0_12px_40px_hsl(var(--shade)/0.7)] backdrop-blur">
                    <span className="px-2 text-sm font-semibold">{pending.length} unsaved change{pending.length === 1 ? '' : 's'}</span>
                    {lossCount > 0 && <span className="flex items-center gap-1 text-sm text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" />{lossCount} below cost</span>}
                    <Button variant="ghost" size="sm" onClick={() => setTyped({})} disabled={busy === 'all'}>Discard</Button>
                    <Button size="sm" onClick={saveAll} disabled={busy === 'all' || hasInvalid}>{busy === 'all' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save all</Button>
                </div>
            )}
        </div>
    )
}
