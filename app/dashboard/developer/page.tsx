'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
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
    Check,
    Trash2,
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    Globe,
    BookOpen,
    Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate } from '@/lib/utils'

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

const MAX_KEYS = 5

const LED_COLOR: Record<ApiKey['status'], string> = {
    active: 'var(--neon-mint)',
    pending: 'var(--neon-amber)',
    revoked: 'var(--neon-coral)',
}

function Led({ status, className }: { status: ApiKey['status']; className?: string }) {
    return (
        <span
            aria-hidden
            className={cn('led', className)}
            style={{ '--led': LED_COLOR[status] } as React.CSSProperties}
        />
    )
}

function StatusBadge({ status }: { status: ApiKey['status'] }) {
    const variant = status === 'active' ? 'success' : status === 'pending' ? 'pending' : 'failed'
    return (
        <Badge variant={variant}>
            <Led status={status} className="h-1.5 w-1.5" />
            {status}
        </Badge>
    )
}

function CopyBox({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            toast.success(`${label} copied`)
            setTimeout(() => setCopied(false), 1800)
        } catch {
            toast.error('Could not copy. Select the text and copy it manually.')
        }
    }

    return (
        <div className="neo-inset flex items-start gap-3 rounded-2xl py-3 pl-4 pr-2">
            <span
                className={cn(
                    'flex-1 select-all py-1 font-mono text-[13px] leading-relaxed text-foreground/90',
                    multiline ? 'whitespace-pre-wrap break-all' : 'break-all'
                )}
            >
                {value}
            </span>
            <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleCopy}
                aria-label={`Copy ${label}`}
            >
                {copied ? <Check className="h-4 w-4 text-[hsl(var(--neon-mint))]" /> : <Copy className="h-4 w-4" />}
            </Button>
        </div>
    )
}

function QuickStart() {
    const [origin, setOrigin] = useState('https://your-domain')
    useEffect(() => {
        setOrigin(window.location.origin)
    }, [])

    const snippet = `curl ${origin}/api/v1/packages \\\n  -H "Authorization: Bearer YOUR_API_KEY"`

    return (
        <Card className="lg:col-span-3">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-3 text-lg">
                    <span className="neo-raised-sm flex h-9 w-9 items-center justify-center rounded-xl text-primary">
                        <Terminal className="h-4 w-4" />
                    </span>
                    Make your first request
                </CardTitle>
                <CardDescription>
                    Send your API key as a Bearer token on every request.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <CopyBox value={snippet} label="Example request" multiline />
            </CardContent>
        </Card>
    )
}

function KeySlots({ keys }: { keys: ApiKey[] }) {
    const live = keys.filter(k => k.status !== 'revoked')

    return (
        <Card className="lg:col-span-2">
            <CardContent className="flex h-full flex-col justify-between gap-5 p-6">
                <div>
                    <h2 className="text-lg font-semibold">Key slots</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {live.length} of {MAX_KEYS} in use
                    </p>
                </div>
                <div
                    className="neo-inset flex items-center justify-between rounded-2xl px-6 py-4"
                    role="img"
                    aria-label={`${live.length} of ${MAX_KEYS} key slots in use`}
                >
                    {Array.from({ length: MAX_KEYS }).map((_, i) => {
                        const k = live[i]
                        return k ? (
                            <Led key={k.id} status={k.status} className="h-3 w-3" />
                        ) : (
                            <span key={`empty-${i}`} className="led led-off h-3 w-3" aria-hidden />
                        )
                    })}
                </div>
                <p className="text-xs text-muted-foreground">Revoking a key frees up its slot.</p>
            </CardContent>
        </Card>
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

    const meta = [
        `Created ${formatDate(apiKey.created_at)}`,
        apiKey.last_used_at ? `Last used ${formatDate(apiKey.last_used_at)}` : 'Never used',
        apiKey.rate_limit_per_min ? `${apiKey.rate_limit_per_min} requests/min` : null,
    ].filter(Boolean) as string[]

    return (
        <Card className={apiKey.status === 'revoked' ? 'opacity-55' : ''}>
            <CardContent className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <Led status={apiKey.status} className="h-2.5 w-2.5" />
                            <span className="font-mono text-base font-medium">{apiKey.key_prefix}…</span>
                            <StatusBadge status={apiKey.status} />
                        </div>
                        {apiKey.label && <p className="text-sm text-foreground/80">{apiKey.label}</p>}
                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {meta.map(m => <li key={m}>{m}</li>)}
                        </ul>
                    </div>
                    {apiKey.status !== 'revoked' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-[hsl(var(--neon-coral))] hover:bg-[hsl(var(--neon-coral)/0.10)] hover:text-[hsl(var(--neon-coral))]"
                            onClick={handleRevoke}
                            disabled={isRevoking}
                        >
                            {isRevoking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                            Revoke key
                        </Button>
                    )}
                </div>

                {/* Webhook settings: only editable for keys that are not revoked */}
                {apiKey.status !== 'revoked' && (
                    <div className="space-y-4 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4 sm:p-5">
                        <div className="space-y-1">
                            <Label htmlFor={`webhook-${apiKey.id}`} className="text-sm font-semibold">Webhook URL</Label>
                            <p className="text-xs text-muted-foreground">
                                We send signed order updates to this address. It must be a public https:// URL.
                            </p>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="relative flex-1">
                                <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id={`webhook-${apiKey.id}`}
                                    className="pl-10 font-mono text-[13px]"
                                    placeholder="https://example.com/webhook"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                />
                            </div>
                            <Button
                                variant="outline"
                                className="shrink-0"
                                onClick={handleSaveWebhook}
                                disabled={isSavingWebhook}
                            >
                                {isSavingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save webhook'}
                            </Button>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleRotate}
                            disabled={isRotating}
                        >
                            {isRotating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                            Rotate signing secret
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

interface RevealProps {
    tone: 'mint' | 'amber'
    title: string
    body: React.ReactNode
    value: string
    copyLabel: string
    confirmLabel: string
    onConfirm: () => void
}

/** One-time secret reveal: lit with a neon edge so it cannot be missed. */
function Reveal({ tone, title, body, value, copyLabel, confirmLabel, onConfirm }: RevealProps) {
    return (
        <Card className={tone === 'mint' ? 'neon-edge-mint' : 'neon-edge-amber'}>
            <CardContent className="space-y-4 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                    <span
                        className={cn(
                            'neo-inset mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                            tone === 'mint' ? 'text-[hsl(var(--neon-mint))]' : 'text-[hsl(var(--neon-amber))]'
                        )}
                    >
                        <AlertCircle className="h-4 w-4" />
                    </span>
                    <div>
                        <h2 className="text-base font-semibold">{title}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                    </div>
                </div>
                <CopyBox value={value} label={copyLabel} />
                <Button variant="outline" size="sm" onClick={onConfirm}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    {confirmLabel}
                </Button>
            </CardContent>
        </Card>
    )
}

export default function DeveloperPage() {
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
        toast.success('Signing secret rotated. Copy it now.')
    }

    if (isLoading) {
        return (
            <div className="flex min-h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary drop-shadow-[0_0_10px_hsl(var(--neon-cyan)/0.7)]" />
            </div>
        )
    }

    const activeKeys = keys.filter(k => k.status !== 'revoked')
    const atLimit = activeKeys.length >= MAX_KEYS

    return (
        <div className="dev-page mx-auto max-w-4xl space-y-8">
            {/* Page header */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-xl">
                    <h1 className="text-3xl font-semibold tracking-tight">Developer API</h1>
                    <p className="mt-2 text-muted-foreground">
                        Create API keys and set up webhooks to sell data bundles from your own app.
                    </p>
                </div>
                <Button variant="outline" asChild className="shrink-0 gap-2">
                    <Link href="/dashboard/developer/docs">
                        <BookOpen className="h-4 w-4" />
                        API documentation
                    </Link>
                </Button>
            </div>

            {/* Quick start and key capacity */}
            <div className="grid gap-6 lg:grid-cols-5">
                <QuickStart />
                <KeySlots keys={keys} />
            </div>

            {/* Once-only secret reveal after rotate */}
            {newSecretReveal && (
                <Reveal
                    tone="amber"
                    title={`New signing secret for ${newSecretReveal.keyPrefix}…`}
                    body="This is the only time we show it. Update your webhook handler to verify requests with this secret."
                    value={newSecretReveal.secret}
                    copyLabel="Signing secret"
                    confirmLabel="I've saved this secret"
                    onConfirm={() => setNewSecretReveal(null)}
                />
            )}

            {/* Once-only raw key reveal after creation */}
            {justCreated && (
                <Reveal
                    tone="mint"
                    title="Copy your new API key"
                    body="This is the only time we show it. Store it somewhere safe and treat it like a password."
                    value={justCreated.key}
                    copyLabel="API key"
                    confirmLabel="I've saved this key"
                    onConfirm={() => setJustCreated(null)}
                />
            )}

            {/* Create key */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-lg">
                        <span className="neo-raised-sm flex h-9 w-9 items-center justify-center rounded-xl text-primary">
                            <Plus className="h-4 w-4" />
                        </span>
                        Create an API key
                    </CardTitle>
                    <CardDescription>
                        You can have up to {MAX_KEYS} active keys. New keys stay pending until an admin approves them.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreate} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-2">
                            <Label htmlFor="key-label">Label (optional)</Label>
                            <Input
                                id="key-label"
                                placeholder="e.g. Production, CI/CD"
                                value={newLabel}
                                onChange={(e) => setNewLabel(e.target.value)}
                                maxLength={80}
                            />
                        </div>
                        <Button type="submit" disabled={isCreating || atLimit} className="shrink-0">
                            {isCreating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                            {atLimit ? 'Limit reached' : 'Create key'}
                        </Button>
                    </form>
                    {atLimit && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-[hsl(var(--neon-amber))]">
                            <AlertCircle className="h-3.5 w-3.5" />
                            You have reached the {MAX_KEYS}-key limit. Revoke a key to create a new one.
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Key list */}
            <section className="space-y-4" aria-labelledby="keys-heading">
                <div className="flex items-center gap-3">
                    <h2 id="keys-heading" className="text-xl font-semibold">Your keys</h2>
                    <Badge variant="secondary">{keys.length}</Badge>
                </div>
                {keys.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                            <span className="neo-inset flex h-12 w-12 items-center justify-center rounded-2xl text-muted-foreground">
                                <Key className="h-5 w-5" />
                            </span>
                            <p className="font-medium">No API keys yet</p>
                            <p className="max-w-sm text-sm text-muted-foreground">
                                Create your first key above to start using the API.
                            </p>
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
            </section>
        </div>
    )
}
