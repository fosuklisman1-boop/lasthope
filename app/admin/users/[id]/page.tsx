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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Loader2, Wallet, ShoppingCart, MessageSquare, StickyNote, History, UserX, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { roleConfig, type UserRole } from '@/lib/roles'

const ROLES = Object.keys(roleConfig) as UserRole[]

function when(iso?: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusVariant(s: string): 'success' | 'pending' | 'failed' | 'processing' | 'secondary' {
    if (['completed', 'active', 'approved', 'resolved', 'paid'].includes(s)) return 'success'
    if (['pending', 'unpaid'].includes(s)) return 'pending'
    if (['failed', 'rejected', 'suspended', 'refunded'].includes(s)) return 'failed'
    if (s === 'processing') return 'processing'
    return 'secondary'
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
}

export default function AdminUserDetailPage() {
    const { id } = useParams<{ id: string }>()
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [note, setNote] = useState('')
    const [savingNote, setSavingNote] = useState(false)

    const [adjustOpen, setAdjustOpen] = useState(false)
    const [adjType, setAdjType] = useState<'credit' | 'debit'>('credit')
    const [adjAmount, setAdjAmount] = useState('')
    const [adjReason, setAdjReason] = useState('')
    const [adjusting, setAdjusting] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/users/${id}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load this user')
            setData(json)
            setError(null)
        } catch (e: any) {
            setError(e.message || 'Failed to load this user')
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => { load() }, [load])

    const post = async (url: string, body: unknown) => {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const json = await res.json().catch(() => ({}))
        return { res, json }
    }

    const changeRole = async (role: string) => {
        const { res, json } = await post('/api/admin/users/role', { userId: id, role })
        if (!res.ok) return toast.error(json.error || 'Failed to change the role')
        toast.success('Role updated')
        load()
    }

    const changeStatus = async (status: 'active' | 'suspended') => {
        const verb = status === 'suspended' ? 'suspend' : 'reactivate'
        if (!confirm(`Are you sure you want to ${verb} this account?`)) return
        const { res, json } = await post('/api/admin/users/update-status', { userId: id, status })
        if (!res.ok) return toast.error(json.error || `Failed to ${verb} the account`)
        toast.success(status === 'suspended' ? 'Account suspended' : 'Account reactivated')
        load()
    }

    const submitAdjustment = async () => {
        const amount = parseFloat(adjAmount)
        if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid amount')
        setAdjusting(true)
        try {
            let { res, json } = await post('/api/admin/users/wallet/adjustment', {
                userId: id, amount, type: adjType, reason: adjReason, confirmLarge: false,
            })
            if (res.status === 409 && json.code === 'needs_confirmation') {
                if (!confirm(`${json.error}.\n\nReally ${adjType} GHS ${amount.toFixed(2)}?`)) return
                ;({ res, json } = await post('/api/admin/users/wallet/adjustment', {
                    userId: id, amount, type: adjType, reason: adjReason, confirmLarge: true,
                }))
            }
            if (!res.ok) throw new Error(json.error || 'Failed to adjust the wallet')
            toast.success(`Wallet ${adjType === 'credit' ? 'credited' : 'debited'}`)
            setAdjustOpen(false)
            setAdjAmount('')
            setAdjReason('')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setAdjusting(false)
        }
    }

    const addNote = async () => {
        setSavingNote(true)
        try {
            const { res, json } = await post(`/api/admin/users/${id}/notes`, { body: note })
            if (!res.ok) throw new Error(json.error || 'Failed to save the note')
            setNote('')
            toast.success('Note added')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSavingNote(false)
        }
    }

    if (loading) {
        return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    }
    if (error || !data) {
        return (
            <div className="dev-page mx-auto max-w-lg space-y-4">
                <Button variant="ghost" asChild><Link href="/admin/users"><ArrowLeft className="mr-2 h-4 w-4" />Back to users</Link></Button>
                <Card><CardContent className="p-8 text-center text-muted-foreground">{error || 'User not found'}</CardContent></Card>
            </div>
        )
    }

    const { user, wallet } = data
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2 text-muted-foreground">
                <Link href="/admin/users"><ArrowLeft className="h-4 w-4" />Back to users</Link>
            </Button>

            {/* Identity and actions */}
            <Card>
                <CardContent className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
                            <Badge variant="secondary">{roleConfig[user.role as UserRole]?.label ?? user.role}</Badge>
                            <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {user.email}{user.phone_number ? ` · ${user.phone_number}` : ''} · Joined {when(user.created_at)}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{user.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Select value={user.role} onValueChange={changeRole}>
                            <SelectTrigger className="w-44" aria-label="Change role"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {ROLES.map(r => <SelectItem key={r} value={r}>{roleConfig[r].label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Button onClick={() => setAdjustOpen(true)}><Wallet className="mr-2 h-4 w-4" />Adjust wallet</Button>
                        {user.status === 'suspended' ? (
                            <Button variant="success" onClick={() => changeStatus('active')}><UserCheck className="mr-2 h-4 w-4" />Reactivate</Button>
                        ) : (
                            <Button variant="outline" onClick={() => changeStatus('suspended')}><UserX className="mr-2 h-4 w-4" />Suspend</Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Numbers */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    ['Wallet balance', formatCurrency(Number(wallet?.balance ?? 0))],
                    ['Total credited', formatCurrency(Number(wallet?.total_credited ?? 0))],
                    ['Total spent', formatCurrency(Number(wallet?.total_spent ?? 0))],
                    ['Orders', String(data.orderCount)],
                ].map(([label, value]) => (
                    <Card key={label}>
                        <CardContent className="p-5">
                            <p className="text-sm text-muted-foreground">{label}</p>
                            <p className="mt-1 text-2xl font-bold">{value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {(data.shop || data.apiKeys.length > 0) && (
                <p className="text-sm text-muted-foreground">
                    {data.shop && <>Runs the shop <span className="font-medium text-foreground">{data.shop.name}</span>{data.shop.is_active ? '' : ' (inactive)'}. </>}
                    {data.apiKeys.length > 0 && <>{data.apiKeys.filter((k: any) => k.status === 'active').length} active API key(s) of {data.apiKeys.length}.</>}
                </p>
            )}

            <Tabs defaultValue="orders" className="space-y-5">
                <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-2">
                    <TabsList className="w-max">
                        <TabsTrigger value="orders" className="gap-2"><ShoppingCart className="h-4 w-4" />Orders</TabsTrigger>
                        <TabsTrigger value="wallet" className="gap-2"><Wallet className="h-4 w-4" />Wallet</TabsTrigger>
                        <TabsTrigger value="support" className="gap-2"><MessageSquare className="h-4 w-4" />Support</TabsTrigger>
                        <TabsTrigger value="notes" className="gap-2"><StickyNote className="h-4 w-4" />Notes ({data.notes.length})</TabsTrigger>
                        <TabsTrigger value="activity" className="gap-2"><History className="h-4 w-4" />Admin activity</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="orders">
                    <Card><CardContent className="p-2 sm:p-4">
                        {data.orders.length === 0 ? <Empty>No orders yet.</Empty> : (
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Reference</TableHead><TableHead>Bundle</TableHead><TableHead>Phone</TableHead>
                                    <TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {data.orders.map((o: any) => (
                                        <TableRow key={o.id}>
                                            <TableCell className="font-mono text-xs">{o.reference_code}</TableCell>
                                            <TableCell>{o.network} {o.size}</TableCell>
                                            <TableCell>{o.phone_number}</TableCell>
                                            <TableCell>{formatCurrency(Number(o.price))}</TableCell>
                                            <TableCell><Badge variant={statusVariant(o.status)}>{o.status}</Badge></TableCell>
                                            <TableCell className="whitespace-nowrap text-muted-foreground">{when(o.created_at)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                        {data.orderCount > data.orders.length && (
                            <p className="px-3 pt-3 text-xs text-muted-foreground">Showing the latest {data.orders.length} of {data.orderCount} orders.</p>
                        )}
                    </CardContent></Card>
                </TabsContent>

                <TabsContent value="wallet">
                    <Card><CardContent className="p-2 sm:p-4">
                        {data.transactions.length === 0 ? <Empty>No wallet activity yet.</Empty> : (
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Source</TableHead>
                                    <TableHead>Description</TableHead><TableHead>Date</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {data.transactions.map((t: any) => (
                                        <TableRow key={t.id}>
                                            <TableCell><Badge variant={t.type === 'credit' ? 'success' : 'secondary'}>{t.type}</Badge></TableCell>
                                            <TableCell className="font-medium">{t.type === 'credit' ? '+' : '−'}{formatCurrency(Number(t.amount))}</TableCell>
                                            <TableCell className="text-muted-foreground">{t.source}</TableCell>
                                            <TableCell className="max-w-xs truncate">{t.description}</TableCell>
                                            <TableCell className="whitespace-nowrap text-muted-foreground">{when(t.created_at)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>
                </TabsContent>

                <TabsContent value="support">
                    <div className="grid gap-5 md:grid-cols-2">
                        <Card><CardContent className="space-y-3 p-5">
                            <h2 className="font-semibold">Complaints</h2>
                            {data.complaints.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : data.complaints.map((c: any) => (
                                <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate">{c.subject || 'Complaint'}</span>
                                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                                </div>
                            ))}
                        </CardContent></Card>
                        <Card><CardContent className="space-y-3 p-5">
                            <h2 className="font-semibold">Withdrawals</h2>
                            {data.withdrawals.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : data.withdrawals.map((w: any) => (
                                <div key={w.id} className="flex items-center justify-between gap-3 text-sm">
                                    <span>{formatCurrency(Number(w.amount))} · {when(w.created_at)}</span>
                                    <Badge variant={statusVariant(w.status)}>{w.status}</Badge>
                                </div>
                            ))}
                        </CardContent></Card>
                    </div>
                </TabsContent>

                <TabsContent value="notes" className="space-y-4">
                    <Card><CardContent className="space-y-3 p-5">
                        <Label htmlFor="new-note">Add a private note</Label>
                        <Textarea id="new-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000}
                            placeholder="Context for other admins. The user never sees notes." />
                        <Button onClick={addNote} disabled={savingNote || note.trim().length === 0}>
                            {savingNote && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save note
                        </Button>
                    </CardContent></Card>
                    {data.notes.map((n: any) => (
                        <Card key={n.id}><CardContent className="space-y-2 p-5">
                            <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                            <p className="text-xs text-muted-foreground">{n.author_email ?? 'Unknown admin'} · {when(n.created_at)}</p>
                        </CardContent></Card>
                    ))}
                </TabsContent>

                <TabsContent value="activity">
                    <Card><CardContent className="space-y-4 p-5">
                        {data.activity.length === 0 ? <Empty>No admin actions recorded for this account.</Empty> : data.activity.map((a: any) => (
                            <div key={a.id} className="space-y-0.5 border-b border-border pb-3 last:border-0 last:pb-0">
                                <p className="text-sm font-medium">{a.summary}</p>
                                {a.reason && <p className="text-sm text-muted-foreground">Reason: {a.reason}</p>}
                                <p className="text-xs text-muted-foreground">{a.actor_email ?? 'Unknown admin'} · {when(a.created_at)}</p>
                            </div>
                        ))}
                        <Button variant="link" asChild className="h-auto p-0"><Link href="/admin/audit-log">Open the full audit log</Link></Button>
                    </CardContent></Card>
                </TabsContent>
            </Tabs>

            {/* Wallet adjustment */}
            <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Adjust wallet</DialogTitle>
                        <DialogDescription>Credit or debit {name}'s wallet. The user is notified.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select value={adjType} onValueChange={(v: 'credit' | 'debit') => setAdjType(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="credit">Credit (add funds)</SelectItem>
                                    <SelectItem value="debit">Debit (take funds)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="adj-amount">Amount (GHS)</Label>
                            <Input id="adj-amount" type="number" inputMode="decimal" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="adj-reason">Reason (required)</Label>
                            <Input id="adj-reason" value={adjReason} onChange={e => setAdjReason(e.target.value)} maxLength={300}
                                placeholder="e.g. Failed top-up compensation, ticket #1234" />
                            <p className="text-xs text-muted-foreground">The user sees this in their wallet history. It is also saved in the audit log.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                        <Button variant={adjType === 'debit' ? 'destructive' : 'default'} onClick={submitAdjustment}
                            disabled={adjusting || adjReason.trim().length < 5 || !adjAmount}>
                            {adjusting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {adjType === 'credit' ? 'Credit wallet' : 'Debit wallet'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
