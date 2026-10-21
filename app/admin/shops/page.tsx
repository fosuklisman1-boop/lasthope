'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Search, Store } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

interface ShopRow {
    id: string
    name: string
    slug: string
    ownerActive: boolean
    owner: { id: string; email: string; name: string; status: string } | null
    paidOrders: number
    sales: number
    lastSale: string | null
    totalEarnings: number
    available: number
    pendingWithdrawal: number
    suspended: boolean
    withdrawalsHeld: boolean
    profileLocked: boolean
    maxMarginPercent: number | null
}
interface Limits { maxMarginPercent: number | null; minWithdrawal: number | null }

function when(iso: string | null) {
    return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No sales yet'
}

export default function ShopsPage() {
    const [shops, setShops] = useState<ShopRow[]>([])
    const [limits, setLimits] = useState<Limits | null>(null)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')

    const [maxMargin, setMaxMargin] = useState('')
    const [minWithdrawal, setMinWithdrawal] = useState('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/shops')
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load shops')
            setShops(json.shops)
            setLimits(json.limits)
            setMaxMargin(json.limits?.maxMarginPercent != null ? String(json.limits.maxMarginPercent) : '')
            setMinWithdrawal(json.limits?.minWithdrawal != null ? String(json.limits.minWithdrawal) : '')
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const saveLimits = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: [
                    { key: 'shop_max_margin_percent', value: maxMargin.trim() },
                    { key: 'shop_min_withdrawal', value: minWithdrawal.trim() },
                ] }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the limits')
            toast.success('Platform limits saved')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase()
        return shops.filter(s => {
            if (filter === 'suspended' && !s.suspended) return false
            if (filter === 'held' && !s.withdrawalsHeld) return false
            if (filter === 'pending' && s.pendingWithdrawal <= 0) return false
            if (!q) return true
            return s.name.toLowerCase().includes(q) || s.slug.includes(q) || (s.owner?.email ?? '').toLowerCase().includes(q) || (s.owner?.name ?? '').toLowerCase().includes(q)
        })
    }, [shops, filter, search])

    const totals = useMemo(() => ({
        shops: shops.length,
        suspended: shops.filter(s => s.suspended).length,
        available: shops.reduce((n, s) => n + Math.max(0, s.available), 0),
        pending: shops.reduce((n, s) => n + s.pendingWithdrawal, 0),
    }), [shops])

    if (forbidden) return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can manage shops.</CardContent></Card>
    if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>

    return (
        <div className="dev-page mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Shops</h1>
                <p className="text-muted-foreground">Reseller shops, what they have earned, and the controls you have over them.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    ['Shops', String(totals.shops)],
                    ['Suspended', String(totals.suspended)],
                    ['Owed to shop owners', formatCurrency(totals.available)],
                    ['Withdrawals waiting', formatCurrency(totals.pending)],
                ].map(([label, value]) => (
                    <Card key={label}><CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="mt-1 text-2xl font-bold">{value}</p>
                    </CardContent></Card>
                ))}
            </div>

            <Card><CardContent className="space-y-4 p-5">
                <div>
                    <h2 className="font-semibold">Limits for every shop</h2>
                    <p className="text-sm text-muted-foreground">A single shop can have its own limit on its page, which replaces these. Leave a box empty for no limit.</p>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="max-margin">Highest margin (% above the owner's cost)</Label>
                        <Input id="max-margin" type="number" inputMode="decimal" min={0} className="w-56" value={maxMargin} onChange={e => setMaxMargin(e.target.value)} placeholder="No limit" />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="min-wd">Smallest withdrawal (GHS)</Label>
                        <Input id="min-wd" type="number" inputMode="decimal" min={0} className="w-48" value={minWithdrawal} onChange={e => setMinWithdrawal(e.target.value)} placeholder="No minimum" />
                    </div>
                    <Button onClick={saveLimits} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save limits</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    With a 30% limit, a shop whose owner pays 10.00 can charge at most 13.00. Prices above the limit are lowered to it when they are saved and at checkout.
                    {limits === null ? ' The current limits could not be read.' : ''}
                </p>
            </CardContent></Card>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs value={filter} onValueChange={setFilter}>
                    <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-1">
                        <TabsList className="w-max">
                            <TabsTrigger value="all">All</TabsTrigger>
                            <TabsTrigger value="suspended">Suspended</TabsTrigger>
                            <TabsTrigger value="held">Withdrawals held</TabsTrigger>
                            <TabsTrigger value="pending">Withdrawal waiting</TabsTrigger>
                        </TabsList>
                    </div>
                </Tabs>
                <div className="relative w-full sm:w-72">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-10" placeholder="Search shop or owner" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            {shown.length === 0 ? (
                <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                    <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground"><Store className="h-5 w-5" /></span>
                    <p className="font-medium">{shops.length === 0 ? 'No shops yet' : 'No shops match'}</p>
                    <p className="max-w-sm text-sm text-muted-foreground">{shops.length === 0 ? 'Shops appear here when a reseller opens one from My Shop.' : 'Try a different filter or search.'}</p>
                </CardContent></Card>
            ) : (
                <Card><CardContent className="p-2 sm:p-4">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Shop</TableHead><TableHead>Owner</TableHead>
                            <TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Earned</TableHead>
                            <TableHead className="text-right">Available</TableHead><TableHead>Last sale</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {shown.map(s => (
                                <TableRow key={s.id}>
                                    <TableCell>
                                        <Link href={`/admin/shops/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {s.suspended && <Badge variant="failed">Suspended</Badge>}
                                            {s.withdrawalsHeld && <Badge variant="pending">Withdrawals held</Badge>}
                                            {s.profileLocked && <Badge variant="secondary">Profile locked</Badge>}
                                            {s.maxMarginPercent !== null && <Badge variant="secondary">Max {s.maxMarginPercent}% margin</Badge>}
                                            {!s.ownerActive && !s.suspended && <Badge variant="secondary">Paused by owner</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {s.owner ? <Link href={`/admin/users/${s.owner.id}`} className="hover:underline">{s.owner.name}</Link> : 'Unknown'}
                                        <p className="text-xs text-muted-foreground">{s.owner?.email}</p>
                                    </TableCell>
                                    <TableCell className="text-right">{formatCurrency(s.sales)}<p className="text-xs text-muted-foreground">{s.paidOrders} orders</p></TableCell>
                                    <TableCell className="text-right">{formatCurrency(s.totalEarnings)}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(s.available)}{s.pendingWithdrawal > 0 && <p className="text-xs font-normal text-[hsl(var(--neon-amber))]">{formatCurrency(s.pendingWithdrawal)} requested</p>}</TableCell>
                                    <TableCell className="whitespace-nowrap text-muted-foreground">{when(s.lastSale)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent></Card>
            )}
        </div>
    )
}
