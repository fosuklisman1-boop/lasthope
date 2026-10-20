'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Loader2, ShieldCheck, ShieldAlert, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

interface Status {
    required: boolean
    envDisabled: boolean
    gate: 'allow' | 'enroll' | 'verify'
    me: { id: string; role: string; hasFactor: boolean; level: string }
    admins?: { id: string; email: string; name: string; role: string; enrolled: boolean }[]
}

interface Enrollment { factorId: string; qr: string; secret: string }

export default function SecurityPage() {
    const [status, setStatus] = useState<Status | null>(null)
    const [loading, setLoading] = useState(true)
    const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
    const [code, setCode] = useState('')
    const [busy, setBusy] = useState(false)
    const [switching, setSwitching] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/security')
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load security settings')
            setStatus(json)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { load() }, [load])

    const startEnrollment = async () => {
        setBusy(true)
        try {
            // Clear out any half-finished attempt so enrolling never trips over it.
            const { data: factors } = await supabase.auth.mfa.listFactors()
            for (const f of factors?.all ?? []) {
                if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
            }
            const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `LASTHOPE admin ${new Date().toISOString().slice(0, 10)}` })
            if (error || !data) throw new Error(error?.message || 'Could not start setup')
            setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
            setCode('')
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }

    const verify = async (factorId: string) => {
        setBusy(true)
        try {
            const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
            if (error) throw new Error(error.message.includes('Invalid') ? 'That code is not right. Check the time on your phone and try the next code.' : error.message)
            toast.success('Verified')
            setEnrollment(null)
            setCode('')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }

    const removeAuthenticator = async () => {
        if (!confirm('Remove your authenticator app? You will have to set it up again to use the admin area while two-factor is required.')) return
        setBusy(true)
        try {
            const { data: factors } = await supabase.auth.mfa.listFactors()
            for (const f of factors?.totp ?? []) {
                const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id })
                if (error) throw new Error(error.message)
            }
            toast.success('Authenticator removed')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setBusy(false)
        }
    }

    const setRequired = async (next: boolean) => {
        const reason = window.prompt(
            next
                ? 'Require two-factor for everyone who opens the admin area?\n\nReason (required):'
                : 'Stop requiring two-factor for the admin area?\n\nReason (required):'
        )
        if (reason === null) return
        if (reason.trim().length < 5) return toast.error('Give a reason of at least 5 characters')

        const send = (confirmLockout: boolean) => fetch('/api/admin/security', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ required: next, reason: reason.trim(), confirmLockout }),
        })

        setSwitching(true)
        try {
            let res = await send(false)
            let json = await res.json().catch(() => ({}))
            if (res.status === 409 && json.code === 'needs_confirmation') {
                const list = (json.notEnrolled as string[]).join('\n')
                if (!confirm(`${json.error}:\n\n${list}\n\nThey can still sign in, but cannot open the admin area until they set up an authenticator. Turn it on anyway?`)) return
                res = await send(true)
                json = await res.json().catch(() => ({}))
            }
            if (!res.ok) throw new Error(json.error || 'Failed to change the setting')
            toast.success(next ? 'Two-factor is now required' : 'Two-factor is no longer required')
            await load()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setSwitching(false)
        }
    }

    if (loading || !status) {
        return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
    }

    const verified = status.me.level === 'aal2'
    const isAdmin = status.me.role === 'admin'

    return (
        <div className="dev-page mx-auto max-w-3xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Security</h1>
                <p className="text-muted-foreground">Protect the admin area with a code from an authenticator app.</p>
            </div>

            {status.gate !== 'allow' && (
                <Card className="neon-edge-amber"><CardContent className="flex items-start gap-3 p-5">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--neon-amber))]" />
                    <div>
                        <p className="font-semibold">Two-factor is required</p>
                        <p className="text-sm text-muted-foreground">
                            {status.gate === 'enroll'
                                ? 'Set up an authenticator app below to keep using the admin area.'
                                : 'Enter the code from your authenticator app below to continue.'}
                        </p>
                    </div>
                </CardContent></Card>
            )}

            {/* My authenticator */}
            <Card><CardContent className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="neo-raised-sm flex h-10 w-10 items-center justify-center rounded-xl text-primary"><Smartphone className="h-5 w-5" /></span>
                        <div>
                            <h2 className="font-semibold">Your authenticator app</h2>
                            <p className="text-sm text-muted-foreground">Google Authenticator, Microsoft Authenticator, 1Password and similar apps all work.</p>
                        </div>
                    </div>
                    <Badge variant={status.me.hasFactor ? (verified ? 'success' : 'pending') : 'secondary'}>
                        {!status.me.hasFactor ? 'Not set up' : verified ? 'Verified this session' : 'Set up, not verified'}
                    </Badge>
                </div>

                {!status.me.hasFactor && !enrollment && (
                    <Button onClick={startEnrollment} disabled={busy}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Set up authenticator
                    </Button>
                )}

                {enrollment && (
                    <div className="space-y-4">
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                            <li>Open your authenticator app and add an account by scanning this code.</li>
                            <li>Enter the 6-digit code the app shows.</li>
                        </ol>
                        <div className="flex flex-wrap items-center gap-5">
                            <img src={enrollment.qr} alt="QR code to add LASTHOPE to your authenticator app" className="h-44 w-44 rounded-2xl bg-white p-2" />
                            <div className="space-y-1">
                                <p className="text-sm text-muted-foreground">Cannot scan? Type this key into the app:</p>
                                <p className="select-all break-all font-mono text-sm">{enrollment.secret}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="enroll-code">6-digit code</Label>
                                <Input id="enroll-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-40 font-mono tracking-widest"
                                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                            </div>
                            <Button onClick={() => verify(enrollment.factorId)} disabled={busy || code.length !== 6}>
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm and turn on
                            </Button>
                        </div>
                    </div>
                )}

                {status.me.hasFactor && !verified && (
                    <VerifyForm code={code} setCode={setCode} busy={busy} onVerify={async () => {
                        const { data } = await supabase.auth.mfa.listFactors()
                        const factor = data?.totp?.[0]
                        if (!factor) return toast.error('No authenticator found. Set one up first.')
                        verify(factor.id)
                    }} />
                )}

                {status.me.hasFactor && verified && (
                    <div className="flex items-center justify-between gap-3">
                        <p className="flex items-center gap-2 text-sm text-[hsl(var(--neon-mint))]"><ShieldCheck className="h-4 w-4" />You have proved your second factor in this session.</p>
                        <Button variant="outline" size="sm" onClick={removeAuthenticator} disabled={busy}>Remove authenticator</Button>
                    </div>
                )}
            </CardContent></Card>

            {/* Enforcement */}
            {isAdmin && (
                <Card className={status.required ? 'neon-edge-mint' : ''}><CardContent className="space-y-5 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="max-w-xl space-y-1">
                            <h2 className="font-semibold">Require two-factor for the admin area</h2>
                            <p className="text-sm text-muted-foreground">
                                When on, admins and sub-admins must enter an authenticator code each time they sign in before the admin area works.
                                Turn it on after everyone has set up their app.
                            </p>
                            {status.envDisabled && (
                                <p className="text-sm text-[hsl(var(--neon-amber))]">Enforcement is switched off by the ADMIN_2FA_DISABLE setting on the server.</p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <Badge variant={status.required ? 'success' : 'secondary'}>{status.required ? 'Required' : 'Optional'}</Badge>
                            <Switch checked={status.required} disabled={switching || (!status.required && !verified)} onCheckedChange={setRequired} aria-label="Require two-factor" />
                        </div>
                    </div>
                    {!status.required && !verified && (
                        <p className="text-xs text-muted-foreground">Set up and verify your own authenticator above before you can turn this on.</p>
                    )}

                    {status.admins && (
                        <div className="space-y-2">
                            <p className="text-sm font-medium">Who has set it up</p>
                            {status.admins.map(a => (
                                <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate">{a.name} <span className="text-muted-foreground">· {a.role}</span></span>
                                    <Badge variant={a.enrolled ? 'success' : 'pending'}>{a.enrolled ? 'Set up' : 'Not yet'}</Badge>
                                </div>
                            ))}
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                        If every admin loses their device, set ADMIN_2FA_DISABLE=true in the server settings and redeploy. That turns enforcement off so you can sign in and set the apps up again.
                    </p>
                </CardContent></Card>
            )}
        </div>
    )
}

function VerifyForm({ code, setCode, busy, onVerify }: { code: string; setCode: (v: string) => void; busy: boolean; onVerify: () => void }) {
    return (
        <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
                <Label htmlFor="verify-code">Code from your app</Label>
                <Input id="verify-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-40 font-mono tracking-widest"
                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            <Button onClick={onVerify} disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify
            </Button>
        </div>
    )
}
