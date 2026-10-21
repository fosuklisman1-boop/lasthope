'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { RateTool } from '@/components/admin/rate-tool'

interface Pkg { id: string; network: string; size: string; cost: number; customPrice: number | null }
export interface SavedShopPrice { package_id: string; custom_price: number; profit_margin: number }

/** Set many shop selling prices from a price per GB. Shows the profit on each sale before saving. */
export function ShopBulkPricing({ shopId, packages, onSaved }: { shopId: string; packages: Pkg[]; onSaved: (rows: SavedShopPrice[]) => void }) {
    const [planned, setPlanned] = useState<Record<string, number>>({})
    const [saving, setSaving] = useState(false)

    const rows = useMemo(() => packages.filter(p => p.id in planned), [packages, planned])
    const lossCount = rows.filter(p => planned[p.id] < p.cost).length

    const save = async () => {
        if (lossCount > 0 && !confirm(`${lossCount} price${lossCount === 1 ? ' is' : 's are'} below your cost, so you would lose money on each sale. Save anyway?`)) return
        setSaving(true)
        try {
            const res = await fetch('/api/user/shop/packages', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopId, items: rows.map(p => ({ packageId: p.id, customPrice: planned[p.id] })) }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the prices')
            toast.success(`Updated ${json.changed} price${json.changed === 1 ? '' : 's'}`)
            onSaved(json.rows)
            setPlanned({})
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Set prices by GB</CardTitle>
                <CardDescription>Enter what you charge per GB and every package is priced for you. Your profit on each one is shown before you save.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <RateTool
                    noun="selling price"
                    rows={packages.map(p => ({ id: p.id, network: p.network, size: p.size, current: p.id in planned ? planned[p.id] : p.customPrice }))}
                    onApply={plan => setPlanned(prev => ({ ...prev, ...plan.updates }))}
                />

                {rows.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{rows.length} price{rows.length === 1 ? '' : 's'} ready to save</p>
                            <div className="flex items-center gap-3">
                                {lossCount > 0 && <span className="flex items-center gap-1 text-sm text-[hsl(var(--neon-amber))]"><AlertTriangle className="h-4 w-4" />{lossCount} below your cost</span>}
                                <Button variant="ghost" size="sm" onClick={() => setPlanned({})} disabled={saving}>Clear</Button>
                                <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save prices</Button>
                            </div>
                        </div>
                        <div className="neo-inset max-h-64 overflow-y-auto rounded-2xl">
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Package</TableHead><TableHead className="text-right">Your cost</TableHead>
                                    <TableHead className="text-right">Sell at</TableHead><TableHead className="text-right">Profit</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {rows.map(p => {
                                        const profit = Math.round((planned[p.id] - p.cost) * 100) / 100
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">{p.network} {p.size}</TableCell>
                                                <TableCell className="text-right text-muted-foreground">{formatCurrency(p.cost)}</TableCell>
                                                <TableCell className="text-right font-semibold">{formatCurrency(planned[p.id])}</TableCell>
                                                <TableCell className={`text-right font-semibold ${profit < 0 ? 'text-[hsl(var(--neon-coral))]' : 'text-[hsl(var(--neon-mint))]'}`}>{formatCurrency(profit)}</TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
