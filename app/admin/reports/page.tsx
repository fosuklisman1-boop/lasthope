'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

interface Day { day: string; orders: number; revenue: number; profit: number }
interface Group { orders: number; revenue: number; profit: number }
interface Report {
    from: string
    to: string
    totals: { orders: number; completed: number; failed: number; revenue: number; cost: number; profit: number; successRate: number }
    days: Day[]
    byNetwork: (Group & { network: string })[]
    byTier: (Group & { tier: string })[]
    topPackages: { network: string; size: string; orders: number; revenue: number }[]
}

const TIER_LABEL: Record<string, string> = {
    user: 'Customers', agent: 'Agents', 'super-agent': 'Super agents', 'premium-agent': 'Premium agents',
    dealer: 'Dealers', guest: 'Guest checkout', admin: 'Admin', 'sub-admin': 'Sub-admin',
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000))

function RevenueChart({ days }: { days: Day[] }) {
    const max = Math.max(1, ...days.map(d => d.revenue))
    const W = 640, H = 170, pad = 4
    const barW = Math.max(2, (W - pad * 2) / days.length - 2)
    const total = days.reduce((s, d) => s + d.revenue, 0)

    return (
        <figure>
            <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label={`Daily revenue, ${days.length} days, total ${formatCurrency(total)}`}>
                {[0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={0} x2={W} y1={H - f * (H - 10)} y2={H - f * (H - 10)} stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="3 5" />
                ))}
                {days.map((d, i) => {
                    const h = Math.max(d.revenue > 0 ? 2 : 0, (d.revenue / max) * (H - 10))
                    const x = pad + i * ((W - pad * 2) / days.length)
                    return (
                        <g key={d.day}>
                            <title>{`${d.day}: ${formatCurrency(d.revenue)} from ${d.orders} orders`}</title>
                            <rect x={x} y={H - h} width={barW} height={h} rx={2} fill="hsl(var(--neon-cyan))" opacity={0.85} />
                        </g>
                    )
                })}
                <text x={0} y={H + 16} fontSize={11} fill="hsl(var(--muted-foreground))">{days[0]?.day}</text>
                <text x={W} y={H + 16} fontSize={11} textAnchor="end" fill="hsl(var(--muted-foreground))">{days[days.length - 1]?.day}</text>
                <text x={W} y={12} fontSize={11} textAnchor="end" fill="hsl(var(--muted-foreground))">{`Peak ${formatCurrency(max)}`}</text>
            </svg>
        </figure>
    )
}

function GroupTable({ title, rows, label }: { title: string; rows: (Group & { name: string })[]; label: string }) {
    return (
        <Card><CardContent className="space-y-3 p-4 sm:p-5">
            <h2 className="font-semibold">{title}</h2>
            {rows.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No completed orders in this period.</p> : (
                <Table>
                    <TableHeader><TableRow>
                        <TableHead>{label}</TableHead><TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Profit</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                        {rows.map(r => (
                            <TableRow key={r.name}>
                                <TableCell className="font-medium">{r.name}</TableCell>
                                <TableCell className="text-right">{r.orders}</TableCell>
                                <TableCell className="text-right">{formatCurrency(Number(r.revenue))}</TableCell>
                                <TableCell className="text-right">{formatCurrency(Number(r.profit))}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </CardContent></Card>
    )
}

export default function ReportsPage() {
    const [from, setFrom] = useState(daysAgo(29))
    const [to, setTo] = useState(daysAgo(0))
    const [report, setReport] = useState<Report | null>(null)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)

    const query = useMemo(() => `from=${from}&to=${to}`, [from, to])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/reports?${query}`)
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load the report')
            setReport(json)
        } catch (e: any) {
            toast.error(e.message || 'Failed to load the report')
        } finally {
            setLoading(false)
        }
    }, [query])

    useEffect(() => { load() }, [load])

    if (forbidden) {
        return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can view reports.</CardContent></Card>
    }

    const preset = (n: number) => { setFrom(daysAgo(n - 1)); setTo(daysAgo(0)) }
    const t = report?.totals

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
                    <p className="text-muted-foreground">Revenue and profit from completed orders. Dates are in Ghana time.</p>
                </div>
                <Button variant="outline" asChild>
                    <a href={`/api/admin/reports?${query}&format=csv`} download><Download className="mr-2 h-4 w-4" />Download CSV</a>
                </Button>
            </div>

            <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
                <div className="space-y-1.5"><Label htmlFor="from">From</Label><Input id="from" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="to">To</Label><Input id="to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
                <div className="flex gap-2">
                    {[7, 30, 90].map(n => <Button key={n} variant="outline" size="sm" onClick={() => preset(n)}>Last {n} days</Button>)}
                </div>
            </CardContent></Card>

            {loading && !report ? (
                <div className="flex min-h-[240px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : report && t && (
                <>
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        {[
                            ['Revenue', formatCurrency(t.revenue)],
                            ['Profit', formatCurrency(t.profit)],
                            ['Completed orders', String(t.completed)],
                            ['Success rate', `${t.successRate}%`],
                        ].map(([label, value]) => (
                            <Card key={label}><CardContent className="p-5">
                                <p className="text-sm text-muted-foreground">{label}</p>
                                <p className="mt-1 text-2xl font-bold">{value}</p>
                            </CardContent></Card>
                        ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {t.orders} orders placed, {t.completed} completed, {t.failed} failed. Profit is price minus cost on completed orders.
                    </p>

                    <Card><CardContent className="space-y-2 p-4 sm:p-5">
                        <h2 className="font-semibold">Daily revenue</h2>
                        <RevenueChart days={report.days} />
                    </CardContent></Card>

                    <div className="grid gap-5 lg:grid-cols-2">
                        <GroupTable title="By network" label="Network" rows={report.byNetwork.map(n => ({ ...n, name: n.network }))} />
                        <GroupTable title="By customer type" label="Type" rows={report.byTier.map(x => ({ ...x, name: TIER_LABEL[x.tier] ?? x.tier }))} />
                    </div>

                    <Card><CardContent className="space-y-3 p-4 sm:p-5">
                        <h2 className="font-semibold">Best-selling bundles</h2>
                        {report.topPackages.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No completed orders in this period.</p> : (
                            <Table>
                                <TableHeader><TableRow><TableHead>Bundle</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {report.topPackages.map(p => (
                                        <TableRow key={`${p.network}-${p.size}`}>
                                            <TableCell className="font-medium">{p.network} {p.size}</TableCell>
                                            <TableCell className="text-right">{p.orders}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(Number(p.revenue))}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent></Card>
                </>
            )}
        </div>
    )
}
