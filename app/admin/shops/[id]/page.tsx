'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

interface Detail {
    shop: { id: string; name: string; slug: string; description: string | null; logo_url: string | null; theme_color: string | null; is_active: boolean }
    owner: { id: string; email: string; name: string; phone: string | null; status: string } | null
    controls: {
        suspended: boolean; suspended_reason: string | null; suspended_message: string | null; withdrawals_held: boolean; hold_reason: string | null
        max_margin_percent: number | null; min_withdrawal: number | null; profile_locked: boolean; notes: string | null
    }
    platform: { maxMarginPercent: number | null; minWithdrawal: number | null }
    effective: { maxMarginPercent: number | null; minWithdrawal: number | null }
    balance: { totalEarnings: number; withdrawn: number; pending: number; available: number }
    ledger: { id: string; kind: string; amount: number | string; reason: string; created_at: string }[]
    blocked: { package_id: string; reason: string | null }[]
    packages: { id: string; network: string; size: string }[]
    orders: { id: string; reference_code: string; network: string; size: string; price: number; profit_amount: number | null; status: string; payment_status: string; created_at: string }[]
    withdrawals: { id: string; amount: number; status: string; created_at: string }[]
}

const KIND: Record<string, string> = { adjustment: 'Adjustment', order_reversal: 'Order profit cancelled', archived: 'Archived with old orders' }

function when(iso: string) {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminShopDetailPage() {
    const { id } = useParams<{ id: string }>()
    const [data, setData] = useState<Detail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    // forms
    const [suspendMessage, setSuspendMessage] = useState('')
    const [suspendHold, setSuspendHold] = useState(true)
    const [maxMargin, setMaxMargin] = useState('')
    const [minWd, setMinWd] = useState('')
    const [notes, setNotes] = useState('')
    const [adjType, setAdjType] = useState<'credit' | 'debit'>('credit')
    const [adjAmount, setAdjAmount] = useState('')
    const [adjReason, setAdjReason] = useState('')
    const [pName, setPName] = useState('')
    const [pDesc, setPDesc] = useState('')
    const [pSlug, setPSlug] = useState('')
    const [pReason, setPReason] = useState('')

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/shops/${id}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load this shop')
            setData(json)
            setMaxMargin(json.controls.max_margin_percent === null ? '' : String(json.controls.max_margin_percent))
            setMinWd(json.controls.min_withdrawal === null ? '' : String(json.controls.min_withdrawal))
            setNotes(json.controls.notes ?? '')
            setPName(json.shop.name); setPDesc(json.shop.description ?? ''); setPSlug(json.shop.slug)
            setError(null)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => { load() }, [load])

    const request = async (url: string, method: string, body?: unknown) => {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
        const json = await res.json().catch(() => ({}))
        return { res, json }
    }

    /** Ask for a reason, run a control action, refresh. */
    const act = async (key: string, question: string, extra: Record<string, unknown>, okMessage: string, action: string) => {
        const reason = window.prompt(`${question}\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        setBusy(key)
        try {
            const { res, json } = await request(`/api/admin/shops/${id}`, 'PATCH', { action, reason: reason.trim(), ...extra })
            if (!res.ok) throw new Error(json.error || 'That did not go through')
            toast.success(okMessage)
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    const submitAdjustment = async () => {
        const amount = parseFloat(adjAmount)
        if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid amount')
        setBusy('adjust')
        try {
            const send = (confirmLarge: boolean) => request(`/api/admin/shops/${id}/adjustments`, 'POST', { type: adjType, amount, reason: adjReason, confirmLarge })
            let { res, json } = await send(false)
            if (res.status === 409 && json.code === 'needs_confirmation') {
                if (!confirm(`${json.error}.\n\nReally ${adjType === 'credit' ? 'add' : 'take away'} GHS ${amount.toFixed(2)}?`)) return
                ;({ res, json } = await send(true))
            }
            if (!res.ok) throw new Error(json.error || 'Failed to save the adjustment')
            toast.success(adjType === 'credit' ? 'Profit added' : 'Profit taken away')
            setAdjAmount(''); setAdjReason('')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    const reverseOrder = async (orderId: string, ref: string) => {
        const reason = window.prompt(`Cancel the profit on order ${ref}? The shop owner is told.\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        setBusy(`rev-${orderId}`)
        try {
            const { res, json } = await request(`/api/admin/shops/${id}/adjustments`, 'POST', { type: 'reverse_order', orderId, reason: reason.trim() })
            if (!res.ok) throw new Error(json.error || 'Failed to cancel the profit')
            toast.success('Profit cancelled')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    const saveProfile = async () => {
        if (!data) return
        const fields: Record<string, unknown> = {}
        if (pName.trim() !== data.shop.name) fields.name = pName
        if ((pDesc.trim() || null) !== (data.shop.description || null)) fields.description = pDesc
        if (pSlug.trim().toLowerCase() !== data.shop.slug) fields.slug = pSlug
        if (Object.keys(fields).length === 0) return toast.error('Nothing has changed')
        setBusy('profile')
        try {
            const { res, json } = await request(`/api/admin/shops/${id}`, 'PATCH', { action: 'edit', reason: pReason.trim(), ...fields })
            if (!res.ok) throw new Error(json.error || 'Failed to save')
            toast.success('Shop profile updated')
            setPReason('')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(null)
        }
    }

    const deleteShop = async () => {
        if (!data) return
        const reason = window.prompt(`Delete the shop "${data.shop.name}" for good? This only works for a shop that never sold anything.\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        const res = await fetch(`/api/admin/shops/${id}?reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) return toast.error(json.error || 'Failed to delete the shop')
        toast.success('Shop deleted')
        window.location.href = '/admin/shops'
    }

    if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    if (error || !data) {
        return (
            <div className="mx-auto max-w-lg space-y-4">
                <Button variant="ghost" asChild><Link href="/admin/shops"><ArrowLeft className="mr-2 h-4 w-4" />Back to shops</Link></Button>
                <Card><CardContent className="p-8 text-center text-muted-foreground">{error || 'Shop not found'}</CardContent></Card>
            </div>
        )
    }

    const { shop, owner, controls, balance, effective, platform } = data
    const blockedIds = new Set(data.blocked.map(b => b.package_id))

    return (
        <div className="dev-page mx-auto max-w-5xl space-y-6 pb-12">
            <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2 text-muted-foreground"><Link href="/admin/shops"><ArrowLeft className="h-4 w-4" />Back to shops</Link></Button>

            <Card><CardContent className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-2xl font-bold tracking-tight">{shop.name}</h1>
                        {controls.suspended && <Badge variant="failed">Suspended</Badge>}
                        {controls.withdrawals_held && <Badge variant="pending">Withdrawals held</Badge>}
                        {controls.profile_locked && <Badge variant="secondary">Profile locked</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Owner: {owner ? <Link href={`/admin/users/${owner.id}`} className="text-primary hover:underline">{owner.name}</Link> : 'unknown'}{owner ? ` · ${owner.email}` : ''}
                    </p>
                    <a href={`/s/${shop.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">/s/{shop.slug}<ExternalLink className="h-3 w-3" /></a>
                </div>
            </CardContent></Card>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    ['Earned', formatCurrency(balance.totalEarnings)],
                    ['Withdrawn', formatCurrency(balance.withdrawn)],
                    ['Waiting', formatCurrency(balance.pending)],
                    ['Available', formatCurrency(balance.available)],
                ].map(([label, value]) => (
                    <Card key={label}><CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className={`mt-1 text-2xl font-bold ${label === 'Available' && balance.available < 0 ? 'text-[hsl(var(--neon-coral))]' : ''}`}>{value}</p>
                    </CardContent></Card>
                ))}
            </div>

            <Tabs defaultValue="controls" className="space-y-5">
                <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-2">
                    <TabsList className="w-max">
                        <TabsTrigger value="controls">Controls</TabsTrigger>
                        <TabsTrigger value="profit">Profit</TabsTrigger>
                        <TabsTrigger value="bundles">Bundles</TabsTrigger>
                        <TabsTrigger value="orders">Orders</TabsTrigger>
                        <TabsTrigger value="profile">Profile</TabsTrigger>
                    </TabsList>
                </div>

                {/* ── Controls ─────────────────────────────────────────── */}
                <TabsContent value="controls" className="space-y-5">
                    <Card className={controls.suspended ? 'neon-edge-amber' : ''}><CardContent className="space-y-4 p-5">
                        <div>
                            <h2 className="font-semibold">{controls.suspended ? 'This shop is suspended' : 'Suspend this shop'}</h2>
                            <p className="text-sm text-muted-foreground">While suspended, customers cannot open the storefront or buy, and the owner cannot switch it back on.</p>
                        </div>
                        {controls.suspended ? (
                            <>
                                {controls.suspended_message && <p className="neo-inset rounded-xl px-4 py-3 text-sm">Customers see: {controls.suspended_message}</p>}
                                {controls.suspended_reason && <p className="text-sm text-muted-foreground">Reason: {controls.suspended_reason}</p>}
                                <div className="flex flex-wrap gap-3">
                                    <Button disabled={busy === 'unsuspend'} onClick={() => act('unsuspend', 'Reactivate this shop?', { releaseHold: false }, 'Shop reactivated', 'unsuspend')}>Reactivate</Button>
                                    {controls.withdrawals_held && <Button variant="outline" disabled={busy === 'unsuspend'} onClick={() => act('unsuspend', 'Reactivate this shop and release its withdrawals?', { releaseHold: true }, 'Shop reactivated and withdrawals released', 'unsuspend')}>Reactivate and release withdrawals</Button>}
                                </div>
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="susp-msg">Message customers see (optional)</Label>
                                    <Input id="susp-msg" value={suspendMessage} maxLength={200} onChange={e => setSuspendMessage(e.target.value)} placeholder="e.g. This shop is closed for maintenance." />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch id="susp-hold" checked={suspendHold} onCheckedChange={setSuspendHold} />
                                    <Label htmlFor="susp-hold" className="text-sm">Also hold the owner's withdrawals</Label>
                                </div>
                                <Button variant="destructive" disabled={busy === 'suspend'} onClick={() => act('suspend', `Suspend "${shop.name}"? The owner is told.`, { message: suspendMessage, holdWithdrawals: suspendHold }, 'Shop suspended', 'suspend')}>
                                    {busy === 'suspend' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Suspend shop
                                </Button>
                            </div>
                        )}
                    </CardContent></Card>

                    <Card><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                        <div className="max-w-xl">
                            <h2 className="font-semibold">Withdrawals</h2>
                            <p className="text-sm text-muted-foreground">{controls.withdrawals_held ? `On hold${controls.hold_reason ? `: ${controls.hold_reason}` : ''}. The owner cannot request a withdrawal.` : 'The owner can request withdrawals as normal.'}</p>
                        </div>
                        <Button variant="outline" disabled={busy === 'hold'} onClick={() => act('hold', controls.withdrawals_held ? 'Release this shop\'s withdrawals?' : 'Hold this shop\'s withdrawals?', { held: !controls.withdrawals_held }, controls.withdrawals_held ? 'Withdrawals released' : 'Withdrawals held', 'hold')}>
                            {controls.withdrawals_held ? 'Release withdrawals' : 'Hold withdrawals'}
                        </Button>
                    </CardContent></Card>

                    <Card><CardContent className="space-y-4 p-5">
                        <div>
                            <h2 className="font-semibold">Limits for this shop</h2>
                            <p className="text-sm text-muted-foreground">Leave a box empty to use the platform limit{platform.maxMarginPercent !== null || platform.minWithdrawal !== null ? ` (${[platform.maxMarginPercent !== null ? `${platform.maxMarginPercent}% margin` : '', platform.minWithdrawal !== null ? `${formatCurrency(platform.minWithdrawal)} minimum` : ''].filter(Boolean).join(', ')})` : ', which is not set'}.</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-4">
                            <div className="space-y-1.5"><Label htmlFor="mm">Highest margin (%)</Label><Input id="mm" type="number" inputMode="decimal" min={0} className="w-40" value={maxMargin} onChange={e => setMaxMargin(e.target.value)} placeholder={effective.maxMarginPercent !== null ? String(effective.maxMarginPercent) : 'No limit'} /></div>
                            <div className="space-y-1.5"><Label htmlFor="mw">Smallest withdrawal (GHS)</Label><Input id="mw" type="number" inputMode="decimal" min={0} className="w-44" value={minWd} onChange={e => setMinWd(e.target.value)} placeholder={effective.minWithdrawal !== null ? String(effective.minWithdrawal) : 'No minimum'} /></div>
                            <Button disabled={busy === 'limits'} onClick={() => act('limits', 'Save the limits for this shop?', { max_margin_percent: maxMargin.trim() === '' ? null : Number(maxMargin), min_withdrawal: minWd.trim() === '' ? null : Number(minWd) }, 'Limits saved', 'limits')}>Save limits</Button>
                        </div>
                    </CardContent></Card>

                    <Card><CardContent className="space-y-3 p-5">
                        <Label htmlFor="notes" className="font-semibold">Private notes</Label>
                        <Textarea id="notes" value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)} placeholder="Only admins see this." />
                        <Button variant="outline" disabled={busy === 'notes'} onClick={async () => {
                            setBusy('notes')
                            const { res, json } = await request(`/api/admin/shops/${id}`, 'PATCH', { action: 'notes', notes })
                            setBusy(null)
                            if (!res.ok) return toast.error(json.error || 'Failed to save')
                            toast.success('Notes saved')
                        }}>Save notes</Button>
                    </CardContent></Card>
                </TabsContent>

                {/* ── Profit ───────────────────────────────────────────── */}
                <TabsContent value="profit" className="space-y-5">
                    <Card><CardContent className="space-y-4 p-5">
                        <div>
                            <h2 className="font-semibold">Adjust profit</h2>
                            <p className="text-sm text-muted-foreground">Add or take away profit. It changes what the owner can withdraw, and they are told why. Entries cannot be edited or deleted; correct a mistake with another entry.</p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end">
                            <div className="space-y-1.5">
                                <Label>Type</Label>
                                <Select value={adjType} onValueChange={(v: 'credit' | 'debit') => setAdjType(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="credit">Add profit</SelectItem><SelectItem value="debit">Take away profit</SelectItem></SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5"><Label htmlFor="aa">Amount (GHS)</Label><Input id="aa" type="number" inputMode="decimal" min={0} value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="0.00" /></div>
                            <div className="space-y-1.5"><Label htmlFor="ar">Reason (required)</Label><Input id="ar" value={adjReason} maxLength={300} onChange={e => setAdjReason(e.target.value)} placeholder="Shown to the owner" /></div>
                            <Button variant={adjType === 'debit' ? 'destructive' : 'default'} disabled={busy === 'adjust' || !adjAmount || adjReason.trim().length < 5} onClick={submitAdjustment}>
                                {busy === 'adjust' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                            </Button>
                        </div>
                        {adjType === 'debit' && Number(adjAmount) > balance.available && <p className="text-xs text-[hsl(var(--neon-amber))]">This is more than the available {formatCurrency(balance.available)}, so the balance will go negative and later sales will pay it back.</p>}
                    </CardContent></Card>

                    <Card><CardContent className="p-2 sm:p-4">
                        <h2 className="px-2 pb-2 pt-1 font-semibold">Profit ledger</h2>
                        {data.ledger.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No adjustments yet.</p> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {data.ledger.map(l => (
                                        <TableRow key={l.id}>
                                            <TableCell className="whitespace-nowrap text-muted-foreground">{when(l.created_at)}</TableCell>
                                            <TableCell>{KIND[l.kind] ?? l.kind}</TableCell>
                                            <TableCell className={`text-right font-semibold ${Number(l.amount) < 0 ? 'text-[hsl(var(--neon-coral))]' : 'text-[hsl(var(--neon-mint))]'}`}>{Number(l.amount) > 0 ? '+' : '−'}{formatCurrency(Math.abs(Number(l.amount)))}</TableCell>
                                            <TableCell className="max-w-xs text-muted-foreground">{l.reason}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>

                    <Card><CardContent className="p-2 sm:p-4">
                        <h2 className="px-2 pb-2 pt-1 font-semibold">Withdrawals</h2>
                        {data.withdrawals.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No withdrawals yet.</p> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {data.withdrawals.map(w => (
                                        <TableRow key={w.id}>
                                            <TableCell className="text-muted-foreground">{when(w.created_at)}</TableCell>
                                            <TableCell>{formatCurrency(Number(w.amount))}</TableCell>
                                            <TableCell><Badge variant={w.status === 'approved' ? 'success' : w.status === 'pending' ? 'pending' : 'failed'}>{w.status}</Badge></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>
                </TabsContent>

                {/* ── Bundles ──────────────────────────────────────────── */}
                <TabsContent value="bundles">
                    <Card><CardContent className="space-y-3 p-2 sm:p-4">
                        <p className="px-2 pt-1 text-sm text-muted-foreground">Switch a bundle off for this shop only. It disappears from the storefront and checkout, and the owner cannot turn it back on.</p>
                        {data.packages.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">There are no packages.</p> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>Bundle</TableHead><TableHead className="w-40 text-right">For this shop</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {data.packages.map(p => {
                                        const off = blockedIds.has(p.id)
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell className="font-medium">{p.network} {p.size}{off && <Badge variant="failed" className="ml-2">Switched off</Badge>}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" variant={off ? 'default' : 'outline'} disabled={busy === `pk-${p.id}`} onClick={async () => {
                                                        const reason = window.prompt(`${off ? 'Switch back on' : 'Switch off'} ${p.network} ${p.size} for this shop?\n\nReason (required):`)
                                                        if (reason === null) return
                                                        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
                                                        setBusy(`pk-${p.id}`)
                                                        const { res, json } = await request(`/api/admin/shops/${id}`, 'PATCH', { action: off ? 'unblock_package' : 'block_package', packageId: p.id, reason: reason.trim() })
                                                        setBusy(null)
                                                        if (!res.ok) return toast.error(json.error || 'That did not go through')
                                                        toast.success(off ? 'Bundle is back on' : 'Bundle switched off')
                                                        load()
                                                    }}>{off ? 'Switch on' : 'Switch off'}</Button>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>
                </TabsContent>

                {/* ── Orders ───────────────────────────────────────────── */}
                <TabsContent value="orders">
                    <Card><CardContent className="p-2 sm:p-4">
                        <p className="px-2 pb-2 pt-1 text-sm text-muted-foreground">The latest orders. Orders older than 14 days are archived: their profit stays in the balance but they are no longer listed.</p>
                        {data.orders.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No orders in the last 14 days.</p> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Bundle</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Profit</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                                <TableBody>
                                    {data.orders.map(o => (
                                        <TableRow key={o.id}>
                                            <TableCell className="font-mono text-xs">{o.reference_code}<p className="font-sans text-muted-foreground">{when(o.created_at)}</p></TableCell>
                                            <TableCell>{o.network} {o.size}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(Number(o.price))}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(Number(o.profit_amount) || 0)}</TableCell>
                                            <TableCell><Badge variant={o.payment_status === 'paid' ? 'success' : 'secondary'}>{o.payment_status}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                {o.payment_status === 'paid' && Number(o.profit_amount) > 0 && (
                                                    <Button size="sm" variant="ghost" disabled={busy === `rev-${o.id}`} onClick={() => reverseOrder(o.id, o.reference_code)}>Cancel profit</Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>
                </TabsContent>

                {/* ── Profile ──────────────────────────────────────────── */}
                <TabsContent value="profile" className="space-y-5">
                    <Card><CardContent className="space-y-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="font-semibold">Shop profile</h2>
                                <p className="text-sm text-muted-foreground">Fix or clean up what customers see.{controls.profile_locked ? ' The owner cannot change this profile right now.' : ''}</p>
                            </div>
                            <Button variant="outline" size="sm" disabled={busy === 'lock'} onClick={() => act('lock', controls.profile_locked ? 'Let the owner edit the shop profile again?' : 'Stop the owner editing the shop profile?', { locked: !controls.profile_locked }, controls.profile_locked ? 'Profile unlocked' : 'Profile locked', 'lock')}>
                                {controls.profile_locked ? 'Unlock profile' : 'Lock profile'}
                            </Button>
                        </div>
                        <div className="space-y-1.5"><Label htmlFor="pn">Name</Label><Input id="pn" value={pName} maxLength={60} onChange={e => setPName(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label htmlFor="pd">Description</Label><Textarea id="pd" value={pDesc} maxLength={300} onChange={e => setPDesc(e.target.value)} /></div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ps">Address</Label>
                            <div className="flex items-center gap-2"><span className="font-mono text-sm text-muted-foreground">/s/</span><Input id="ps" className="font-mono" value={pSlug} maxLength={60} onChange={e => setPSlug(e.target.value)} /></div>
                            <p className="text-xs text-muted-foreground">Changing the address breaks links the owner has already shared. The owner is told.</p>
                        </div>
                        {shop.logo_url && (
                            <Button variant="outline" size="sm" disabled={busy === 'logo'} onClick={() => act('logo', 'Remove this shop\'s logo?', { logo_url: null }, 'Logo removed', 'edit')}>Remove logo</Button>
                        )}
                        <div className="space-y-1.5"><Label htmlFor="pr">Reason (required)</Label><Input id="pr" value={pReason} maxLength={300} onChange={e => setPReason(e.target.value)} placeholder="Saved in the audit log" /></div>
                        <Button disabled={busy === 'profile' || pReason.trim().length < 5} onClick={saveProfile}>{busy === 'profile' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save profile</Button>
                    </CardContent></Card>

                    <Card><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                        <div className="max-w-xl">
                            <h2 className="font-semibold text-[hsl(var(--neon-coral))]">Delete shop</h2>
                            <p className="text-sm text-muted-foreground">Only possible for a shop that never sold anything. A shop with sales or profit history can only be suspended, so no money is lost.</p>
                        </div>
                        <Button variant="destructive" onClick={deleteShop}>Delete shop</Button>
                    </CardContent></Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
