'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { KIND_LABEL, type Issue, type IssueKind } from '@/lib/reconciliation'

type Row = Issue & { userEmail: string | null }

interface Report {
    days: number
    checked: number
    truncated: boolean
    atRisk: number
    issues: Row[]
}

function when(iso: string) {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const FIX_LABEL: Record<NonNullable<Issue['fix']>, string> = {
    credit: 'Credit wallet',
    verify: 'Check with Paystack',
}

export default function ReconciliationPage() {
    const [days, setDays] = useState('30')
    const [report, setReport] = useState<Report | null>(null)
    const [loading, setLoading] = useState(true)
    const [forbidden, setForbidden] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/reconciliation?days=${days}`)
            if (res.status === 403) { setForbidden(true); return }
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to run the check')
            setReport(json)
        } catch (e: any) {
            toast.error(e.message || 'Failed to run the check')
        } finally {
            setLoading(false)
        }
    }, [days])

    useEffect(() => { load() }, [load])

    const fix = async (issue: Row) => {
        if (!issue.fix) return
        const what = issue.fix === 'credit'
            ? `Credit GHS ${issue.amount.toFixed(2)} to ${issue.userEmail ?? 'this user'}? Paystack is checked first.`
            : 'Ask Paystack what happened to this payment?'
        const reason = window.prompt(`${what}\n\nReason (required):`)
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')

        setBusyId(issue.paymentId)
        try {
            const res = await fetch('/api/admin/reconciliation/fix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId: issue.paymentId, action: issue.fix, reason: reason.trim() }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'The fix did not go through')
            const messages: Record<string, string> = {
                credited: 'Wallet credited',
                completed: 'Payment completed and wallet credited',
                failed: 'Paystack says it failed, so it was marked failed',
                still_pending: 'Paystack still shows it as pending',
            }
            toast.success(messages[json.outcome] ?? 'Done')
            load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusyId(null)
        }
    }

    if (forbidden) {
        return <Card className="mx-auto max-w-lg"><CardContent className="p-8 text-center text-muted-foreground">Only admins can run reconciliation.</CardContent></Card>
    }

    const issues = report?.issues ?? []

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Payment reconciliation</h1>
                    <p className="text-muted-foreground">Checks that every wallet top-up was paid, credited once and for the right amount.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={days} onValueChange={setDays}>
                        <SelectTrigger className="w-40" aria-label="Period"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                            <SelectItem value="90">Last 90 days</SelectItem>
                            <SelectItem value="180">Last 180 days</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={load} disabled={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Run again
                    </Button>
                </div>
            </div>

            {loading && !report ? (
                <div className="flex min-h-[240px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : report && (
                <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Card><CardContent className="p-5">
                            <p className="text-sm text-muted-foreground">Top-ups checked</p>
                            <p className="mt-1 text-2xl font-bold">{report.checked}</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <p className="text-sm text-muted-foreground">Issues found</p>
                            <p className="mt-1 text-2xl font-bold">{issues.length}</p>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <p className="text-sm text-muted-foreground">Paid but not credited</p>
                            <p className="mt-1 text-2xl font-bold">{formatCurrency(report.atRisk)}</p>
                        </CardContent></Card>
                    </div>

                    {report.truncated && (
                        <p className="text-sm text-[hsl(var(--neon-amber))]">There is more data than one check can cover. Pick a shorter period to see everything.</p>
                    )}

                    {issues.length === 0 ? (
                        <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                            <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-[hsl(var(--neon-mint))]">
                                <ShieldCheck className="h-5 w-5" />
                            </span>
                            <p className="font-medium">Everything matches</p>
                            <p className="max-w-sm text-sm text-muted-foreground">
                                All {report.checked} top-ups in this period were credited once for the right amount.
                            </p>
                        </CardContent></Card>
                    ) : (
                        <div className="space-y-3">
                            {issues.map(issue => (
                                <Card key={issue.paymentId}>
                                    <CardContent className="space-y-3 p-4 sm:p-5">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="space-y-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant={issue.severity === 'high' ? 'failed' : 'pending'}>
                                                        {KIND_LABEL[issue.kind as IssueKind]}
                                                    </Badge>
                                                    <span className="font-semibold">{formatCurrency(issue.amount)}</span>
                                                </div>
                                                <p className="text-sm text-muted-foreground">{issue.detail}</p>
                                            </div>
                                            {issue.fix && (
                                                <Button size="sm" disabled={busyId === issue.paymentId} onClick={() => fix(issue)}>
                                                    {busyId === issue.paymentId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                    {FIX_LABEL[issue.fix]}
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {issue.userId ? (
                                                <Link href={`/admin/users/${issue.userId}`} className="text-primary hover:underline">{issue.userEmail ?? issue.userId}</Link>
                                            ) : 'Unknown user'}
                                            {' · '}<span className="font-mono">{issue.reference}</span> · {when(issue.createdAt)}
                                        </p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
