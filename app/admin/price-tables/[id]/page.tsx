'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Loader2, AlertTriangle, Percent } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { parsePrice, belowCost, discountedPrice } from '@/lib/price-tables'

interface Row { id: string; network: string; size: string; is_available: boolean; base: number; cost: number; price: number | null }
interface Detail { table: { id: string; name: string; description: string | null }; roles: { slug: string; label: string }[]; packages: Row[] }

export default function PriceTableEditorPage() {
    const { id } = useParams<{ id: string }>()
    const [data, setData] = useState<Detail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [edits, setEdits] = useState<Record<string, string>>({}) // packageId -> typed value ('' clears)
    const [percent, setPercent] = useState('10')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/price-tables/${id}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load this price table')
            setData(json)
            setEdits({})
            setError(null)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => { load() }, [load])

    const valueOf = (r: Row) => (r.id in edits ? edits[r.id] : r.price === null ? '' : String(r.price))
    const numberOf = (r: Row): number | null => { const v = valueOf(r).trim(); if (v === '') return null; const p = parsePrice(v); return p.ok ? p.price : NaN as any }

    // Only the rows whose typed value differs from what is saved.
    const changes = useMemo(() => {
        if (!data) return []
        return data.packages.filter(r => {
            if (!(r.id in edits)) return false
            const typed = edits[r.id].trim()
            const current = r.price === null ? '' : String(r.price)
            return typed !== current && !(typed !== '' && Number(typed) === r.price)
        })
    }, [data, edits])

    const invalid = changes.some(r => { const v = edits[r.id].trim(); return v !== '' && !parsePrice(v).ok })
    const lossCount = changes.filter(r => belowCost(numberOf(r), r.cost)).length

    const setValue = (r: Row, v: string) => setEdits(e => ({ ...e, [r.id]: v }))

    const fillEmpty = () => {
        if (!data) return
        const pct = Number(percent)
        const next = { ...edits }
        let n = 0
        for (const r of data.packages) {
            if (valueOf(r).trim() !== '') continue
            const p = discountedPrice(r.base, pct)
            if (p !== null) { next[r.id] = String(p); n++ }
        }
        if (n === 0) return toast.error('Nothing to fill. Enter a percentage from 0 to 99.')
        setEdits(next)
        toast.success(`Filled ${n} empty price${n === 1 ? '' : 's'}. Review, then save.`)
    }

    const save = async () => {
        if (!data || changes.length === 0) return
        const reason = window.prompt(`Save ${changes.length} price change${changes.length === 1 ? '' : 's'} to "${data.table.name}"?${lossCount ? `\n\n${lossCount} price${lossCount === 1 ? ' is' : 's are'} below cost.` : ''}\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')

        setSaving(true)
        try {
            const items = changes.map(r => { const v = edits[r.id].trim(); return { packageId: r.id, price: v === '' ? null : Number(v) } })
            const res = await fetch(`/api/admin/price-tables/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, reason: reason.trim() }) })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the prices')
            toast.success(`Saved ${json.changed} change${json.changed === 1 ? '' : 's'}`)
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    if (error || !data) {
        return (
            <div className="mx-auto max-w-lg space-y-4">
                <Button variant="ghost" asChild><Link href="/admin/price-tables"><ArrowLeft className="mr-2 h-4 w-4" />Back to price tables</Link></Button>
                <Card><CardContent className="p-8 text-center text-muted-foreground">{error || 'Price table not found'}</CardContent></Card>
            </div>
        )
    }

    const networks = Array.from(new Set(data.packages.map(p => p.network)))

    return (
        <div className="dev-page mx-auto max-w-4xl space-y-6 pb-24">
            <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2 text-muted-foreground"><Link href="/admin/price-tables"><ArrowLeft className="h-4 w-4" />Back to price tables</Link></Button>

            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">{data.table.name}</h1>
                {data.table.description && <p className="text-muted-foreground">{data.table.description}</p>}
                <p className="text-sm text-muted-foreground">
                    Used by {data.roles.length === 0 ? 'no role yet. Attach it on the Roles page.' : data.roles.map(r => r.label).join(', ')}.
                    Leave a price empty and that package costs the base price.
                </p>
            </div>

            <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
                <div className="space-y-1.5">
                    <Label htmlFor="pct">Fill empty prices with base price minus</Label>
                    <div className="flex items-center gap-2">
                        <Input id="pct" type="number" min={0} max={99} className="w-24" value={percent} onChange={e => setPercent(e.target.value)} />
                        <span className="text-sm text-muted-foreground"><Percent className="inline h-3.5 w-3.5" /></span>
                    </div>
                </div>
                <Button variant="outline" onClick={fillEmpty}>Fill empty prices</Button>
                <p className="text-xs text-muted-foreground">Nothing is saved until you press Save.</p>
            </CardContent></Card>

            {data.packages.length === 0 ? (
                <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">There are no packages yet. Add packages first, then price them here.</CardContent></Card>
            ) : networks.map(network => (
                <Card key={network}><CardContent className="space-y-2 p-3 sm:p-4">
                    <h2 className="px-2 pt-1 font-semibold">{network}</h2>
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Package</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead className="text-right">Base</TableHead>
                            <TableHead className="w-40">Price in this table</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {data.packages.filter(p => p.network === network).map(r => {
                                const v = valueOf(r)
                                const num = numberOf(r)
                                const bad = v.trim() !== '' && !parsePrice(v).ok
                                const loss = !bad && belowCost(num, r.cost)
                                const changed = r.id in edits && changes.includes(r)
                                return (
                                    <TableRow key={r.id} className={changed ? 'bg-primary/5' : ''}>
                                        <TableCell className="font-medium">
                                            {r.size}{!r.is_available && <Badge variant="secondary" className="ml-2">Hidden</Badge>}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">{r.cost > 0 ? formatCurrency(r.cost) : '—'}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(r.base)}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Input type="number" inputMode="decimal" min={0} step="0.01" value={v} onChange={e => setValue(r, e.target.value)}
                                                    placeholder={`${r.base.toFixed(2)} (base)`} aria-label={`Price for ${r.network} ${r.size}`} aria-invalid={bad} className={bad ? 'ring-1 ring-[hsl(var(--neon-coral))]' : ''} />
                                                {loss && <span title={`Below the cost of ${formatCurrency(r.cost)}`} className="text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" /><span className="sr-only">Below cost</span></span>}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent></Card>
            ))}

            {changes.length > 0 && (
                <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-card/95 p-3 shadow-[0_12px_40px_hsl(var(--shade)/0.7)] backdrop-blur">
                    <span className="px-2 text-sm font-semibold">{changes.length} unsaved change{changes.length === 1 ? '' : 's'}</span>
                    {lossCount > 0 && <span className="flex items-center gap-1 text-sm text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" />{lossCount} below cost</span>}
                    <Button variant="ghost" size="sm" onClick={() => setEdits({})} disabled={saving}>Discard</Button>
                    <Button size="sm" onClick={save} disabled={saving || invalid}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save prices</Button>
                </div>
            )}
        </div>
    )
}
