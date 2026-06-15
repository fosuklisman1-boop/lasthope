'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Key,
    Plus,
    Loader2,
    Copy,
    Trash2,
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Globe,
    BookOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'

interface ApiKey {
    id: string
    key_prefix: string
    label: string | null
    status: 'pending' | 'active' | 'revoked'
    rate_limit_per_min: number | null
    webhook_url: string | null
    webhook_events: string[] | null
    created_at: string
    last_used_at: string | null
}

function StatusBadge({ status }: { status: ApiKey['status'] }) {
    if (status === 'active') return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">active</Badge>
    if (status === 'pending') return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">pending</Badge>
    return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">revoked</Badge>
}

function CopyBox({ value, label }: { value: string; label: string }) {
    const handleCopy = () => {
        navigator.clipboard.writeText(value)
        toast.success(`${label} copied to clipboard`)
    }
    return (
        <div className="flex items-center gap-2 bg-muted rounded-md p-3 font-mono text-sm break-all">
            <span className="flex-1 select-all">{value}</span>
            <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={handleCopy}>
                <Copy className="w-3.5 h-3.5" />
            </Button>
        </div>
    )
}

interface KeyRowProps {
    apiKey: ApiKey
    onRevoke: (id: string) => Promise<void>
    onSaveWebhook: (id: string, webhookUrl: string) => Promise<void>
    onRotateSecret: (id: string) => Promise<void>
}

function KeyRow({ apiKey, onRevoke, onSaveWebhook, onRotateSecret }: KeyRowProps) {
    const [webhookUrl, setWebhookUrl] = useState(apiKey.webhook_url ?? '')
    const [isSavingWebhook, setIsSavingWebhook] = useState(false)
    const [isRotating, setIsRotating] = useState(false)
    const [isRevoking, setIsRevoking] = useState(false)

    const handleSaveWebhook = async () => {
        setIsSavingWebhook(true)
        try {
            await onSaveWebhook(apiKey.id, webhookUrl)
        } finally {
            setIsSavingWebhook(false)
        }
    }

    const handleRotate = async () => {
        setIsRotating(true)
        try {
            await onRotateSecret(apiKey.id)
        } finally {
            setIsRotating(false)
        }
    }

    const handleRevoke = async () => {
        if (!confirm(`Revoke key ${apiKey.key_prefix}...? This cannot be undone.`)) return
        setIsRevoking(true)
        try {
            await onRevoke(apiKey.id)
        } finally {
            setIsRevoking(false)
        }
    }

    return (
        <Card className={apiKey.status === 'revoked' ? 'opacity-60' : ''}>
            <CardContent className="p-4 space-y-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <Key className="w-4 h-4 text-muted-foreground" />
                            <span className="font-mono font-bold text-sm">{apiKey.key_prefix}...</span>
                            <StatusBadge status={apiKey.status} />
                        </div>
                        {apiKey.label && <p className="text-xs text-muted-foreground pl-6">{apiKey.label}</p>}
                        <p className="text-[10px] text-muted-foreground pl-6">
                            Created {formatDate(apiKey.created_at)}
                            {apiKey.last_used_at ? ` • Last used ${formatDate(apiKey.last_used_at)}` : ' • Never used'}
                            {apiKey.rate_limit_per_min ? ` • ${apiKey.rate_limit_per_min} req/min` : ''}
                        </p>
                    </div>
                    {apiKey.status !== 'revoked' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={handleRevoke}
                            disabled={isRevoking}
                        >
                            {isRevoking ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                            Revoke
                        </Button>
                    )}
                </div>

                {/* Webhook config — only editable for non-revoked keys */}
                {apiKey.status !== 'revoked' && (
                    <div className="border-t pt-3 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Webhook</p>
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Globe className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                                <Input
                                    className="pl-8 h-8 text-sm"
                                    placeholder="https://example.com/webhook"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                />
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0"
                                onClick={handleSaveWebhook}
                                disabled={isSavingWebhook}
                            >
                                {isSavingWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                            </Button>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={handleRotate}
                            disabled={isRotating}
                        >
                            {isRotating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                            Rotate Signing Secret
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export default function DeveloperPage() {
    const { dbUser } = useAuth()
    const [keys, setKeys] = useState<ApiKey[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isCreating, setIsCreating] = useState(false)
    const [newLabel, setNewLabel] = useState('')
    const [justCreated, setJustCreated] = useState<{ key: string; prefix: string } | null>(null)
    const [newSecretReveal, setNewSecretReveal] = useState<{ keyPrefix: string; secret: string } | null>(null)

    useEffect(() => {
        fetchKeys()
    }, [])

    const fetchKeys = async () => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/user/api-keys')
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setKeys(data.keys ?? [])
        } catch (error: any) {
            toast.error(error.message || 'Failed to load API keys')
        } finally {
            setIsLoading(false)
        }
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsCreating(true)
        setJustCreated(null)
        try {
            const res = await fetch('/api/user/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: newLabel || undefined }),
            })
            const data = await res.json()
            if (!res.ok) {
                if (data.code === 'key_limit') {
                    toast.error('You have reached the 5-key limit. Revoke an existing key to create a new one.')
                } else {
                    throw new Error(data.error)
                }
                return
            }
            setJustCreated({ key: data.key, prefix: data.prefix })
            setNewLabel('')
            fetchKeys()
        } catch (error: any) {
            toast.error(error.message || 'Failed to create API key')
        } finally {
            setIsCreating(false)
        }
    }

    const handleRevoke = async (id: string) => {
        const res = await fetch('/api/user/api-keys', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
            toast.error(data.error || 'Failed to revoke key')
            return
        }
        toast.success('API key revoked')
        fetchKeys()
    }

    const handleSaveWebhook = async (id: string, webhookUrl: string) => {
        const res = await fetch('/api/user/api-keys', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, webhook_url: webhookUrl }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
            toast.error(data.error || 'Failed to save webhook URL')
            return
        }
        toast.success('Webhook URL saved')
        fetchKeys()
    }

    const handleRotateSecret = async (id: string) => {
        const res = await fetch('/api/user/api-keys', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, rotate_secret: true }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
            toast.error(data.error || 'Failed to rotate secret')
            return
        }
        const key = keys.find(k => k.id === id)
        setNewSecretReveal({ keyPrefix: key?.key_prefix ?? id, secret: data.webhook_secret })
        toast.success('Signing secret rotated — copy it now')
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    const activeKeys = keys.filter(k => k.status !== 'revoked')

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Page header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Developer API</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your API keys and webhook configuration for programmatic access.
                    </p>
                </div>
                <Link href="/dashboard/developer/docs">
                    <Button variant="outline" className="shrink-0 gap-2">
                        <BookOpen className="w-4 h-4" />
                        API Documentation
                    </Button>
                </Link>
            </div>

            {/* Once-only secret reveal after rotate */}
            {newSecretReveal && (
                <Card className="border-amber-300 bg-amber-50">
                    <CardContent className="p-4 space-y-3">
                        <div className="flex items-start gap-2 text-amber-800">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-semibold text-sm">New signing secret for {newSecretReveal.keyPrefix}...</p>
                                <p className="text-xs mt-0.5">
                                    Store this now — it will not be shown again. Update your webhook handler to verify requests with this secret.
                                </p>
                            </div>
                        </div>
                        <CopyBox value={newSecretReveal.secret} label="Signing secret" />
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNewSecretReveal(null)}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> I have saved this secret
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Once-only raw key reveal after creation */}
            {justCreated && (
                <Card className="border-emerald-300 bg-emerald-50">
                    <CardContent className="p-4 space-y-3">
                        <div className="flex items-start gap-2 text-emerald-800">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-semibold text-sm">Your new API key</p>
                                <p className="text-xs mt-0.5">
                                    Copy and store this key now — it will <strong>not</strong> be shown again. Treat it like a password.
                                </p>
                            </div>
                        </div>
                        <CopyBox value={justCreated.key} label="API key" />
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setJustCreated(null)}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> I have saved this key
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Generate key form */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Generate API Key
                    </CardTitle>
                    <CardDescription>
                        You can have up to 5 active keys. New keys start with status <strong>pending</strong> until an admin activates them.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreate} className="flex items-end gap-3">
                        <div className="flex-1 space-y-1.5">
                            <Label htmlFor="key-label">Label (optional)</Label>
                            <Input
                                id="key-label"
                                placeholder="e.g. Production, CI/CD"
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                maxLength={80}
                            />
                        </div>
                        <Button type="submit" disabled={isCreating || activeKeys.length >= 5} className="shrink-0">
                            {isCreating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Key className="w-4 h-4 mr-2" />}
                            {activeKeys.length >= 5 ? 'Limit reached' : 'Generate Key'}
                        </Button>
                    </form>
                    {activeKeys.length >= 5 && (
                        <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            You have reached the 5-key limit. Revoke an existing key to create a new one.
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Key list */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Your Keys ({keys.length})
                </h2>
                {keys.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            <Key className="w-8 h-8 mx-auto mb-3 opacity-30" />
                            <p>No API keys yet. Generate your first key above.</p>
                        </CardContent>
                    </Card>
                ) : (
                    keys.map(apiKey => (
                        <KeyRow
                            key={apiKey.id}
                            apiKey={apiKey}
                            onRevoke={handleRevoke}
                            onSaveWebhook={handleSaveWebhook}
                            onRotateSecret={handleRotateSecret}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
