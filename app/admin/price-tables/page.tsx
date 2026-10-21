'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, Table2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface PriceTable {
    id: string
    name: string
    description: string | null
    itemCount: number
    roles: { slug: string; label: string }[]
}

export default function PriceTablesPage() {
    const [tables, setTables] = useState<PriceTable[]>([])
    const [packageCount, setPackageCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)

    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [copyFrom, setCopyFrom] = useState('none')
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/price-tables')
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load price tables')
            setTables(json.tables)
            setPackageCount(json.packageCount)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const create = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/admin/price-tables', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, copyFrom: copyFrom === 'none' ? undefined : copyFrom }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to create the price table')
            toast.success('Price table created')
            setOpen(false); setName(''); setDescription(''); setCopyFrom('none')
            window.location.href = `/admin/price-tables/${json.table.id}`
        } catch (e: any) {
            toast.error(e.message)
            setSaving(false)
        }
    }

    const remove = async (t: PriceTable) => {
        const reason = window.prompt(`Delete the price table "${t.name}"?\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        const res = await fetch(`/api/admin/price-tables/${t.id}?reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) return toast.error(json.error || 'Failed to delete the price table')
        toast.success('Price table deleted')
        load()
    }

    if (forbidden) return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can manage price tables.</CardContent></Card>
    if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>

    return (
        <div className="dev-page mx-auto max-w-4xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-xl">
                    <h1 className="text-2xl font-bold tracking-tight">Price tables</h1>
                    <p className="text-muted-foreground">A price table is a list of prices. Attach one to a role and everyone with that role pays those prices. A package missing from a table costs the base price.</p>
                </div>
                <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New price table</Button>
            </div>

            {tables.length === 0 ? (
                <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                    <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground"><Table2 className="h-5 w-5" /></span>
                    <p className="font-medium">No price tables yet</p>
                    <p className="max-w-sm text-sm text-muted-foreground">Create one, fill in the prices, then attach it to a role on the Roles page.</p>
                </CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {tables.map(t => (
                        <Card key={t.id}><CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Link href={`/admin/price-tables/${t.id}`} className="font-semibold text-primary hover:underline">{t.name}</Link>
                                    <Badge variant={t.itemCount >= packageCount && packageCount > 0 ? 'success' : 'pending'}>{t.itemCount} of {packageCount} packages priced</Badge>
                                </div>
                                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                                <p className="text-sm text-muted-foreground">
                                    Used by {t.roles.length === 0 ? 'no role yet' : t.roles.map(r => r.label).join(', ')}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" asChild><Link href={`/admin/price-tables/${t.id}`}>Edit prices</Link></Button>
                                <Button variant="ghost" size="sm" className="text-[hsl(var(--neon-coral))] hover:text-[hsl(var(--neon-coral))]" onClick={() => remove(t)} disabled={t.roles.length > 0} title={t.roles.length > 0 ? 'Attach another table to its roles first' : undefined}>
                                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                                </Button>
                            </div>
                        </CardContent></Card>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New price table</DialogTitle>
                        <DialogDescription>Start empty, or copy the prices of an existing table and change what you need.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2"><Label htmlFor="pt-name">Name</Label><Input id="pt-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="e.g. Wholesale" /></div>
                        <div className="space-y-2"><Label htmlFor="pt-desc">Description (optional)</Label><Input id="pt-desc" value={description} maxLength={300} onChange={e => setDescription(e.target.value)} /></div>
                        <div className="space-y-2">
                            <Label>Start from</Label>
                            <Select value={copyFrom} onValueChange={setCopyFrom}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">An empty table</SelectItem>
                                    {tables.map(t => <SelectItem key={t.id} value={t.id}>A copy of {t.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={create} disabled={saving || name.trim().length === 0}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create and edit prices</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
