import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, getSessionAal } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { MFA_SETTING_KEY, evaluateMfaGate, isMfaRequired, mfaDisabledByEnv, clearMfaCache } from '@/lib/mfa'

export const dynamic = 'force-dynamic'

// Status for the Security page. Exempt from the 2FA gate so an admin can enroll or verify.
export async function GET() {
    const auth = await requireAdmin({ allowWithoutMfa: true })
    if (auth instanceof NextResponse) return auth

    const db = auth.supabase as any
    const [required, aal, enrolledRes] = await Promise.all([
        isMfaRequired(),
        getSessionAal(),
        db.rpc('admin_mfa_enrolled'),
    ])
    const enrolled = new Set<string>((enrolledRes.data ?? []).map((r: any) => r.user_id))
    const hasFactor = enrolled.has(auth.userId)
    const envDisabled = mfaDisabledByEnv()

    const gate = evaluateMfaGate({
        required,
        disabledByEnv: envDisabled,
        currentLevel: aal?.currentLevel,
        hasVerifiedFactor: hasFactor,
    })

    let admins: { id: string; email: string; name: string; role: string; enrolled: boolean }[] | undefined
    if (auth.role === 'admin') {
        const { data } = await db.from('users').select('id, email, first_name, last_name, role').in('role', ['admin', 'sub-admin']).eq('status', 'active')
        admins = (data ?? []).map((u: any) => ({
            id: u.id,
            email: u.email,
            name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email,
            role: u.role,
            enrolled: enrolled.has(u.id),
        }))
    }

    return NextResponse.json({
        required,
        envDisabled,
        gate,
        me: { id: auth.userId, role: auth.role, hasFactor, level: aal?.currentLevel ?? 'aal1' },
        admins,
    })
}

// Turn enforcement on or off. Enabling needs a session that has already passed 2FA,
// and a second confirmation when other admins have not enrolled yet (they are locked out until they do).
export async function PUT(request: NextRequest) {
    const auth = await requireAdmin() // full gate: if 2FA is on, only a verified session can change it
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    if (typeof body.required !== 'boolean') return NextResponse.json({ error: 'required (true or false) is needed' }, { status: 400 })
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

    const db = auth.supabase as any
    let notEnrolled: string[] = []

    if (body.required) {
        const aal = await getSessionAal()
        if (aal?.currentLevel !== 'aal2') {
            return NextResponse.json(
                { error: 'Set up and verify your own authenticator first, then turn this on.', code: 'verify_first' },
                { status: 409 }
            )
        }
        const [{ data: admins }, { data: enrolledRows }] = await Promise.all([
            db.from('users').select('id, email').in('role', ['admin', 'sub-admin']).eq('status', 'active'),
            db.rpc('admin_mfa_enrolled'),
        ])
        const enrolled = new Set<string>((enrolledRows ?? []).map((r: any) => r.user_id))
        notEnrolled = (admins ?? []).filter((a: any) => !enrolled.has(a.id)).map((a: any) => a.email)
        if (notEnrolled.length > 0 && body.confirmLockout !== true) {
            return NextResponse.json(
                { error: `${notEnrolled.length} admin(s) have not set up an authenticator and will be locked out until they do`, code: 'needs_confirmation', notEnrolled },
                { status: 409 }
            )
        }
    }

    const { error } = await db.from('admin_settings').upsert({ key: MFA_SETTING_KEY, value: String(body.required) })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    clearMfaCache()

    await logAudit(auth, {
        action: 'security.2fa',
        targetType: 'settings',
        targetId: MFA_SETTING_KEY,
        summary: body.required ? 'Required two-factor authentication for the admin area' : 'Stopped requiring two-factor authentication for the admin area',
        details: { required: body.required, notEnrolled },
        reason,
    }, request)

    return NextResponse.json({ success: true, required: body.required })
}
