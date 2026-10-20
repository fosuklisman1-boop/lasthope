import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createServerClient } from '@/lib/supabase'
import { cookies } from 'next/headers'
import { evaluateMfaGate, isMfaRequired, mfaDisabledByEnv } from '@/lib/mfa'

export type AdminAuth = {
    userId: string
    role: 'admin' | 'sub-admin'
    supabase: ReturnType<typeof createServerClient>
}

// Shared auth+role handshake for app/api/admin/* routes (middleware does not
// protect /api/*, so every admin route must call this first).
// Returns the session + service-role client on success, or a 401/403
// NextResponse to return immediately.
export async function requireAdmin(opts: { allowWithoutMfa?: boolean } = {}): Promise<AdminAuth | NextResponse> {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({
        // @ts-expect-error - Next.js 15 cookie types
        cookies: () => cookieStore
    })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseService = createServerClient()
    const { data: userRecord } = await supabaseService
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single()

    const role = userRecord?.role
    if (!role || !['admin', 'sub-admin'].includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Two-factor: when enforced, the session must have proved a second factor (aal2).
    // The Security page itself is exempt so an admin can enroll or verify.
    if (!opts.allowWithoutMfa && !mfaDisabledByEnv() && (await isMfaRequired())) {
        const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        const gate = aalError || !aal
            ? 'verify'
            : evaluateMfaGate({
                required: true,
                disabledByEnv: false,
                currentLevel: aal.currentLevel,
                hasVerifiedFactor: aal.nextLevel === 'aal2',
            })
        if (gate !== 'allow') {
            return NextResponse.json(
                { error: 'Two-factor authentication is required for the admin area', code: 'mfa_required', action: gate },
                { status: 403 }
            )
        }
    }

    return { userId: user.id, role: role as 'admin' | 'sub-admin', supabase: supabaseService }
}

/** The signed-in session's authenticator assurance level (aal1 = password only, aal2 = second factor proven). */
export async function getSessionAal() {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({
        // @ts-expect-error - Next.js 15 cookie types
        cookies: () => cookieStore
    })
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    return data
}
