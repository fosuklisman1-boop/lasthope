'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { roleConfig, type UserRole } from '@/lib/roles'
import type { Trend } from '@/lib/reports'

interface Row {
    user_id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    role: string
    orders_cur: number
    revenue_cur: number
    orders_prev: number
    revenue_prev: number
    last_order_at: string | null
    trend: Trend
    changePct: number | null
}
interface Summary { total: number; growing: number; declining: number; churned: number; inactive: number }

const TREND: Record<Trend, { label: string; variant: 'success' | 'pending' | 'failed' | 'processing' | 'secondary' }> = {
    growing: { label: 'Growing', variant: 'success' },
    steady: { label: 'Steady', variant: 'secondary' },
    declining: { label: 'Declining', variant: 'pending' },
    churned: { label: 'Went quiet', variant: 'failed' },
    new: { label: 'New activity', variant: 'processing' },
    inactive: { label: 'No orders', variant: 'secondary' },
}

export default function ResellersPage() {
    const [days, setDays] = useState('30')
    const [trend, setTrend] = useState('all')
    const [rows, setRows] = useState<Row[]>([])
    const [summary, setSummary] = useState<Summary | null>(null)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/resellers?days=${days}`)
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load resellers')
            setRows(json.resellers)
            setSummary(json.summary)
        } catch (e: any) {
            toast.error(e.message || 'Failed to load resellers')
        } finally {
            setLoading(false)
        }
    }, [days])

    useEffect(() => { load() }, [load])

    if (forbidden) {
        return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can view resellers.</CardContent></Card>
    }

    const shown = trend === 'all' ? rows : rows.filter(r => r.trend === trend)

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Resellers</h1>
                    <p className="text-muted-foreground">Who is growing and who has gone quiet, compared with the period before.</p>
                </div>
                <Select value={days} onValueChange={setDays}>
                    <SelectTrigger className="w-44" aria-label="Period"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                        <SelectItem value="90">Last 90 days</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {summary && (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {[
                        ['Resellers', summary.total],
                        ['Growing', summary.growing],
                        ['Declining', summary.declining],
                        ['Went quiet', summary.churned],
                    ].map(([label, n]) => (
                        <Card key={label as string}><CardContent className="p-5">
                            <p className="text-sm text-muted-foreground">{label}</p>
                            <p className="mt-1 text-2xl font-bold">{n}</p>
                        </CardContent></Card>
                    ))}
                </div>
            )}

            <Tabs value={trend} onValueChange={setTrend}>
                <div className="scrollbar-hide -mx-1 overflow-x-auto px-1 pb-2">
                    <TabsList className="w-max">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="growing">Growing</TabsTrigger>
                        <TabsTrigger value="declining">Declining</TabsTrigger>
                        <TabsTrigger value="churned">Went quiet</TabsTrigger>
                        <TabsTrigger value="new">New</TabsTrigger>
                        <TabsTrigger value="inactive">No orders</TabsTrigger>
                    </TabsList>
                </div>
            </Tabs>

            {loading ? (
                <div className="flex min-h-[240px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : shown.length === 0 ? (
                <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
                    {rows.length === 0 ? 'No resellers yet. Agents, super agents, premium agents and dealers appear here.' : 'No resellers in this group.'}
                </CardContent></Card>
            ) : (
                <Card><CardContent className="p-2 sm:p-4">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>#</TableHead><TableHead>Reseller</TableHead><TableHead>Tier</TableHead>
                            <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Before</TableHead>
                            <TableHead>Trend</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {shown.map((r, i) => {
                                const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email || 'Unknown'
                                const t = TREND[r.trend]
                                return (
                                    <TableRow key={r.user_id}>
                                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                        <TableCell>
                                            <Link href={`/admin/users/${r.user_id}`} className="font-medium text-primary hover:underline">{name}</Link>
                                            <p className="text-xs text-muted-foreground">{r.orders_cur} orders · {r.email}</p>
                                        </TableCell>
                                        <TableCell>{roleConfig[r.role as UserRole]?.label ?? r.role}</TableCell>
                                        <TableCell className="text-right font-medium">{formatCurrency(r.revenue_cur)}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">{formatCurrency(r.revenue_prev)}</TableCell>
                                        <TableCell>
                                            <Badge variant={t.variant}>{t.label}</Badge>
                                            {r.changePct !== null && r.trend !== 'churned' && (
                                                <span className="ml-2 text-xs text-muted-foreground">{r.changePct > 0 ? '+' : ''}{r.changePct}%</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent></Card>
            )}
            <p className="text-xs text-muted-foreground">Revenue counts completed orders only. "Before" is the same number of days immediately earlier.</p>
        </div>
    )
}
