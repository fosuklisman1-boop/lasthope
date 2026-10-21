'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { RateTool } from '@/components/admin/rate-tool'

interface Pkg { id: string; network: string; size: string; price: number; cost_price?: number | null }

type Field = 'price' | 'cost_price'

interface Props {
    packages: Pkg[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onDone: () => void
}

/** Set the selling price or cost price of many packages from a per-GB rate, review, then save. */
export function BulkPackagePricing({ packages, open, onOpenChange, onDone }: Props) {
    const [field, setField] = useState<Field>('price')
    const [planned, setPlanned] = useState<Record<string, number>>({})
    const [reason, setReason] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => { if (!open) { setPlanned({}); setReason('') } }, [open])
    useEffect(() => { setPlanned({}) }, [field])

    const currentOf = (p: Pkg) => Number(field === 'price' ? p.price : p.cost_price) || 0

    const rows = useMemo(() => packages.filter(p => p.id in planned), [packages, planned])
    const lossCount = rows.filter(p => {
        const price = field === 'price' ? planned[p.id] : Number(p.price)
        const cost = field === 'cost_price' ? planned[p.id] : Number(p.cost_price) || 0
        return cost > 0 && price < cost
    }).length

    const save = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/admin/packages', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field, items: rows.map(p => ({ id: p.id, value: planned[p.id] })), reason: reason.trim() }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the prices')
            toast.success(`Updated ${json.changed} package${json.changed === 1 ? '' : 's'}`)
            onOpenChange(false)
            onDone()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Bulk pricing</DialogTitle>
                    <DialogDescription>Set many packages at once from a price per GB. Prices for roles such as agents and dealers are in Price tables.</DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-2">
                    <div className="space-y-1.5">
                        <Label>What to set</Label>
                        <Select value={field} onValueChange={v => setField(v as Field)}>
                            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="price">Selling price (base)</SelectItem>
                                <SelectItem value="cost_price">Cost price</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <RateTool
                        key={field}
                        noun={field === 'price' ? 'price' : 'cost price'}
                        defaultOverwrite
                        rows={packages.map(p => ({ id: p.id, network: p.network, size: p.size, current: p.id in planned ? planned[p.id] : currentOf(p) || null }))}
                        onApply={plan => setPlanned(prev => ({ ...prev, ...plan.updates }))}
                    />

                    {rows.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium">{rows.length} package{rows.length === 1 ? '' : 's'} will change</p>
                                <div className="flex items-center gap-3">
                                    {lossCount > 0 && <span className="flex items-center gap-1 text-sm text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" />{lossCount} would sell below cost</span>}
                                    <Button variant="ghost" size="sm" onClick={() => setPlanned({})}>Clear</Button>
                                </div>
                            </div>
                            <div className="neo-inset max-h-64 overflow-y-auto rounded-2xl">
                                <Table>
                                    <TableHeader><TableRow><TableHead>Package</TableHead><TableHead className="text-right">Now</TableHead><TableHead className="text-right">New</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {rows.map(p => (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">{p.network} {p.size}</TableCell>
                                                <TableCell className="text-right text-muted-foreground">{currentOf(p) > 0 ? formatCurrency(currentOf(p)) : '—'}</TableCell>
                                                <TableCell className="text-right font-semibold">{formatCurrency(planned[p.id])} {currentOf(p) === planned[p.id] && <Badge variant="secondary" className="ml-1">same</Badge>}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="bulk-reason">Reason (required)</Label>
                                <Input id="bulk-reason" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="Why are these prices changing?" />
                                <p className="text-xs text-muted-foreground">Saved in the audit log.</p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={saving || rows.length === 0 || reason.trim().length < 5}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply {rows.length || ''} price{rows.length === 1 ? '' : 's'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
