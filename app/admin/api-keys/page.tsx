'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    CheckCircle,
    Ban,
    MoreVertical,
    Loader2,
    Key,
    Mail,
    Calendar,
    Clock,
    Gauge,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'

type ApiKey = {
    id: string
    user_id: string
    key_prefix: string
    label: string | null
    status: 'pending' | 'active' | 'revoked'
    rate_limit_per_min: number | null
    created_at: string
    last_used_at: string | null
    webhook_url: string | null
    users: { id: string; email: string } | null
}

const STATUS_BADGE: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    active: 'bg-green-100 text-green-800 border-green-300',
    revoked: 'bg-red-100 text-red-800 border-red-300',
}

export default function AdminApiKeysPage() {
    const [keys, setKeys] = useState<ApiKey[]>([])
    const [loading, setLoading] = useState(true)
    const [total, setTotal] = useState(0)
    const [statusFilter, setStatusFilter] = useState('')
    const [rateLimitDraft, setRateLimitDraft] = useState<Record<string, string>>({})
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const fetchKeys = async () => {
        try {
            setLoading(true)
            const params = new URLSearchParams({ limit: '50', offset: '0' })
            if (statusFilter) params.set('status', statusFilter)
            const response = await fetch(`/api/admin/api-keys?${params.toString()}`)
            if (!response.ok) {
                const result = await response.json()
                throw new Error(result.error || 'Failed to fetch API keys')
            }
            const data = await response.json()
            setKeys(data.keys || [])
            setTotal(data.total || 0)
        } catch (error: any) {
            console.error('Error fetching API keys:', error)
            toast.error(error.message || 'Failed to load API keys')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchKeys()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter])

    const handleAction = async (
        id: string,
        action: 'approve' | 'revoke',
        rate_limit_per_min?: number
    ) => {
        if (action === 'revoke') {
            if (!confirm('Are you sure you want to revoke this API key? The developer will lose access immediately.')) return
        }

        try {
            setActionLoading(id + action)
            const body: Record<string, any> = { id, action }
            if (typeof rate_limit_per_min === 'number' && rate_limit_per_min > 0) {
                body.rate_limit_per_min = rate_limit_per_min
            }

            const response = await fetch('/api/admin/api-keys', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })

            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Action failed')

            toast.success(action === 'approve' ? 'API key approved' : 'API key revoked')
            await fetchKeys()
        } catch (error: any) {
            console.error('Action error:', error)
            toast.error(error.message || 'Failed to perform action')
        } finally {
            setActionLoading(null)
        }
    }

    const handleSaveRateLimit = async (id: string) => {
        const raw = rateLimitDraft[id]
        const value = parseInt(raw, 10)
        if (!raw || isNaN(value) || value <= 0) {
            toast.error('Enter a valid positive number for the rate limit')
            return
        }
        try {
            setActionLoading(id + 'rate')
            const key = keys.find((k) => k.id === id)
            if (!key) return
            const action = key.status === 'active' ? 'approve' : key.status === 'pending' ? 'approve' : 'revoke'
            // We always send the rate_limit update; to avoid a status side-effect for revoked keys
            // we use a dedicated approach: we call PATCH with the current status-compatible action.
            // For revoked keys, the status stays revoked — so we use the PATCH without an action side-effect.
            // Since PATCH requires an action, we re-approve active keys and send rate limit.
            // For revoked keys we simply notify the admin that rate limit can only be changed on active/pending keys.
            if (key.status === 'revoked') {
                toast.error('Cannot change rate limit on a revoked key. Approve it first.')
                return
            }

            const body: Record<string, any> = {
                id,
                action: key.status === 'pending' ? 'approve' : 'approve',
                rate_limit_per_min: value,
            }

            const response = await fetch('/api/admin/api-keys', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })

            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Failed to save rate limit')

            toast.success('Rate limit updated')
            setRateLimitDraft((prev) => {
                const next = { ...prev }
                delete next[id]
                return next
            })
            await fetchKeys()
        } catch (error: any) {
            console.error('Rate limit error:', error)
            toast.error(error.message || 'Failed to update rate limit')
        } finally {
            setActionLoading(null)
        }
    }

    return (
        <div className="space-y-6 pb-20">
            {/* Header */}
            <div className="flex flex-col items-center gap-4 sticky top-0 bg-background/95 backdrop-blur z-30 py-4 border-b text-center">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                        API Key Management
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {total} key{total !== 1 ? 's' : ''} total
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(['', 'pending', 'active', 'revoked'] as const).map((s) => (
                        <Button
                            key={s || 'all'}
                            size="sm"
                            variant={statusFilter === s ? 'default' : 'outline'}
                            className="rounded-xl"
                            onClick={() => setStatusFilter(s)}
                        >
                            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                </div>
            ) : keys.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                    <Key className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>No API keys found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {keys.map((apiKey) => (
                        <Card
                            key={apiKey.id}
                            className="relative overflow-hidden border border-purple-100 dark:border-purple-900/30 transition-all duration-200 shadow-md bg-white dark:bg-slate-900/50"
                        >
                            <CardContent className="p-6 space-y-4">
                                {/* Header row */}
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
                                            <Key className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-slate-900 dark:text-white truncate max-w-[140px]">
                                                {apiKey.label || 'Unlabelled key'}
                                            </p>
                                            <code className="text-xs text-muted-foreground font-mono">
                                                {apiKey.key_prefix}…
                                            </code>
                                        </div>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                                            >
                                                <MoreVertical className="w-4 h-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            {apiKey.status !== 'active' && (
                                                <DropdownMenuItem
                                                    disabled={actionLoading === apiKey.id + 'approve'}
                                                    onClick={() => handleAction(apiKey.id, 'approve')}
                                                >
                                                    <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                                                    Approve
                                                </DropdownMenuItem>
                                            )}
                                            {apiKey.status !== 'revoked' && (
                                                <DropdownMenuItem
                                                    disabled={actionLoading === apiKey.id + 'revoke'}
                                                    onClick={() => handleAction(apiKey.id, 'revoke')}
                                                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                                                >
                                                    <Ban className="w-4 h-4 mr-2" />
                                                    Revoke
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>

                                {/* Status badge */}
                                <div>
                                    <Badge
                                        className={`text-xs border ${STATUS_BADGE[apiKey.status] || ''}`}
                                        variant="outline"
                                    >
                                        {apiKey.status}
                                    </Badge>
                                </div>

                                {/* Details */}
                                <div className="space-y-2 text-sm">
                                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                        <Mail className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                        <span className="truncate">
                                            {apiKey.users?.email || apiKey.user_id}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                        <Calendar className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                                        <span>{formatDate(apiKey.created_at)}</span>
                                    </div>
                                    {apiKey.last_used_at && (
                                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                            <Clock className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
                                            <span>Last used {formatDate(apiKey.last_used_at)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Rate limit editor */}
                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                                        <Gauge className="w-3.5 h-3.5" />
                                        Rate limit (req/min)
                                    </p>
                                    <div className="flex gap-2">
                                        <Input
                                            type="number"
                                            min={1}
                                            className="h-8 text-sm rounded-lg"
                                            placeholder={String(apiKey.rate_limit_per_min ?? 60)}
                                            value={rateLimitDraft[apiKey.id] ?? ''}
                                            onChange={(e) =>
                                                setRateLimitDraft((prev) => ({
                                                    ...prev,
                                                    [apiKey.id]: e.target.value,
                                                }))
                                            }
                                        />
                                        <Button
                                            size="sm"
                                            className="h-8 rounded-lg px-3 text-xs"
                                            disabled={
                                                !rateLimitDraft[apiKey.id] ||
                                                actionLoading === apiKey.id + 'rate'
                                            }
                                            onClick={() => handleSaveRateLimit(apiKey.id)}
                                        >
                                            {actionLoading === apiKey.id + 'rate' ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                'Save'
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
