'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { ROLE_ICONS, ROLE_ICON_NAMES, getRoleConfig } from '@/lib/roles'
import { slugifyRole } from '@/lib/role-rules'
import { useRoles } from '@/components/providers/roles-provider'

interface Role {
    slug: string
    label: string
    kind: 'system' | 'custom'
    is_reseller: boolean
    color: string
    icon: string
    rank: number
    price_table_id: string | null
    price_table_name: string | null
    upgrade_price: number | null
    upgradable: boolean
    user_count: number
}
interface TableOption { id: string; name: string }

interface Form {
    label: string
    color: string
    icon: string
    is_reseller: boolean
    rank: string
    price_table_id: string // 'none' or an id
    upgradable: boolean
    upgrade_price: string
    reason: string
}

const NEVER_PURCHASABLE = ['admin', 'sub-admin', 'user']
const emptyForm: Form = { label: '', color: '#0EA5E9', icon: 'BadgeCheck', is_reseller: false, rank: '100', price_table_id: 'none', upgradable: false, upgrade_price: '', reason: '' }

function RoleBadge({ role }: { role: Pick<Role, 'slug' | 'color' | 'icon'> }) {
    const Icon = ROLE_ICONS[role.icon] ?? getRoleConfig(role.slug).icon
    return (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_4px_12px_hsl(var(--shade)/0.6)]" style={{ backgroundColor: role.color }}>
            <Icon className="h-5 w-5" />
        </span>
    )
}

export default function RolesPage() {
    const { reload: reloadRegistry } = useRoles()
    const [roles, setRoles] = useState<Role[]>([])
    const [tables, setTables] = useState<TableOption[]>([])
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)

    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<Role | null>(null)
    const [form, setForm] = useState<Form>(emptyForm)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/roles')
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load roles')
            setRoles(json.roles)
            setTables(json.priceTables)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true) }
    const openEdit = (r: Role) => {
        setEditing(r)
        setForm({
            label: r.label, color: r.color, icon: ROLE_ICON_NAMES.includes(r.icon) ? r.icon : 'BadgeCheck', is_reseller: r.is_reseller, rank: String(r.rank),
            price_table_id: r.price_table_id ?? 'none', upgradable: r.upgradable, upgrade_price: r.upgrade_price === null ? '' : String(r.upgrade_price), reason: '',
        })
        setOpen(true)
    }

    const canSell = !editing || !NEVER_PURCHASABLE.includes(editing.slug)
    const slugPreview = useMemo(() => slugifyRole(form.label), [form.label])

    // Changing what people pay needs a reason; the server enforces the same rule.
    const sensitive = editing
        ? form.price_table_id !== (editing.price_table_id ?? 'none') ||
          form.upgradable !== editing.upgradable ||
          form.upgrade_price !== (editing.upgrade_price === null ? '' : String(editing.upgrade_price)) ||
          form.is_reseller !== editing.is_reseller
        : false

    const save = async () => {
        const price = form.upgrade_price.trim() === '' ? null : Number(form.upgrade_price)
        const payload: Record<string, unknown> = {
            label: form.label, color: form.color, icon: form.icon, rank: Number(form.rank),
            price_table_id: form.price_table_id === 'none' ? null : form.price_table_id,
            upgradable: canSell ? form.upgradable : false, upgrade_price: canSell ? price : null,
            reason: form.reason.trim() || undefined,
        }
        if (!editing || editing.kind === 'custom') payload.is_reseller = form.is_reseller
        if (editing) payload.slug = editing.slug

        setSaving(true)
        try {
            const res = await fetch('/api/admin/roles', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Failed to save the role')
            toast.success(editing ? 'Role saved' : 'Role created')
            setOpen(false)
            await Promise.all([load(), reloadRegistry()])
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSaving(false)
        }
    }

    const remove = async (r: Role) => {
        const reason = window.prompt(`Delete the role "${r.label}"?\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')
        const res = await fetch(`/api/admin/roles?slug=${encodeURIComponent(r.slug)}&reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) return toast.error(json.error || 'Failed to delete the role')
        toast.success('Role deleted')
        await Promise.all([load(), reloadRegistry()])
    }

    if (forbidden) return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can manage roles.</CardContent></Card>
    if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>

    const formValid = form.label.trim().length > 0 && /^#[0-9A-Fa-f]{6}$/.test(form.color) && (!editing ? slugPreview.length >= 2 : true)
        && (!sensitive || form.reason.trim().length >= 5) && (!(canSell && form.upgradable) || Number(form.upgrade_price) > 0)

    return (
        <div className="dev-page mx-auto max-w-4xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-xl">
                    <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
                    <p className="text-muted-foreground">Add roles like VIP or Wholesale, give each its own prices, and choose who can buy them. Roles only change prices and the reseller extras. They never give admin access.</p>
                </div>
                <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />New role</Button>
            </div>

            <div className="space-y-3">
                {roles.map(r => (
                    <Card key={r.slug}><CardContent className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                        <RoleBadge role={r} />
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{r.label}</span>
                                <span className="font-mono text-xs text-muted-foreground">{r.slug}</span>
                                {r.kind === 'system' && <Badge variant="secondary">Built-in</Badge>}
                                {r.is_reseller && <Badge variant="processing">Reseller</Badge>}
                                {r.upgradable && <Badge variant="success">Can be bought{r.upgrade_price !== null ? ` · ${formatCurrency(r.upgrade_price)}` : ''}</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {r.user_count} {r.user_count === 1 ? 'customer' : 'customers'} · Prices:{' '}
                                {r.price_table_id ? <Link href={`/admin/price-tables/${r.price_table_id}`} className="text-primary hover:underline">{r.price_table_name}</Link> : 'base price'}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(r)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button>
                            {r.kind === 'custom' && (
                                <Button variant="ghost" size="sm" className="text-[hsl(var(--neon-coral))] hover:text-[hsl(var(--neon-coral))]" onClick={() => remove(r)} disabled={r.user_count > 0} title={r.user_count > 0 ? 'Move its customers to another role first' : undefined}>
                                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                                </Button>
                            )}
                        </div>
                    </CardContent></Card>
                ))}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? `Edit ${editing.label}` : 'New role'}</DialogTitle>
                        <DialogDescription>
                            {editing ? <>Role id <span className="font-mono">{editing.slug}</span> cannot be changed.</> : form.label ? <>Role id will be <span className="font-mono">{slugPreview || '…'}</span>.</> : 'Name the role to get started.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="role-label">Name</Label>
                            <Input id="role-label" value={form.label} maxLength={40} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. VIP customer" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="role-color">Colour</Label>
                                <div className="flex items-center gap-2">
                                    <input id="role-color" type="color" value={/^#[0-9A-Fa-f]{6}$/.test(form.color) ? form.color : '#0EA5E9'} onChange={e => setForm(f => ({ ...f, color: e.target.value.toUpperCase() }))}
                                        className="h-10 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0" aria-label="Pick a colour" />
                                    <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="font-mono" maxLength={7} aria-label="Colour code" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Icon</Label>
                                <Select value={form.icon} onValueChange={v => setForm(f => ({ ...f, icon: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROLE_ICON_NAMES.map(n => { const I = ROLE_ICONS[n]; return <SelectItem key={n} value={n}><span className="flex items-center gap-2"><I className="h-4 w-4" />{n}</span></SelectItem> })}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="role-rank">Order in lists</Label>
                                <Input id="role-rank" type="number" min={1} max={1000} value={form.rank} onChange={e => setForm(f => ({ ...f, rank: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Prices</Label>
                                <Select value={form.price_table_id} onValueChange={v => setForm(f => ({ ...f, price_table_id: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Base price</SelectItem>
                                        {tables.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/[0.06] p-4">
                            <div className="space-y-1">
                                <Label htmlFor="role-reseller">Reseller</Label>
                                <p className="text-xs text-muted-foreground">Gives the reseller look, a shop and reseller tools. Built-in roles keep their setting.</p>
                            </div>
                            <Switch id="role-reseller" checked={form.is_reseller} disabled={editing?.kind === 'system'} onCheckedChange={v => setForm(f => ({ ...f, is_reseller: v }))} />
                        </div>

                        {canSell && (
                            <div className="space-y-3 rounded-2xl border border-white/[0.06] p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <Label htmlFor="role-sell">Customers can buy this role</Label>
                                        <p className="text-xs text-muted-foreground">It appears on the Upgrade page with this one-time price.</p>
                                    </div>
                                    <Switch id="role-sell" checked={form.upgradable} onCheckedChange={v => setForm(f => ({ ...f, upgradable: v }))} />
                                </div>
                                {form.upgradable && (
                                    <div className="space-y-2">
                                        <Label htmlFor="role-price">Upgrade price (GHS)</Label>
                                        <Input id="role-price" type="number" inputMode="decimal" min={0} value={form.upgrade_price} onChange={e => setForm(f => ({ ...f, upgrade_price: e.target.value }))} placeholder="0.00" />
                                    </div>
                                )}
                            </div>
                        )}

                        {sensitive && (
                            <div className="space-y-2">
                                <Label htmlFor="role-reason">Reason (required)</Label>
                                <Input id="role-reason" value={form.reason} maxLength={300} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why are prices or purchase options changing?" />
                                <p className="text-xs text-muted-foreground">Saved in the audit log.</p>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} disabled={saving || !formValid}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? 'Save changes' : 'Create role'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
