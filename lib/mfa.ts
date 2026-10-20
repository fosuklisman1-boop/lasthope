import { createServerClient } from '@/lib/supabase'

export const MFA_SETTING_KEY = 'admin_2fa_required'

export type MfaGate = 'allow' | 'enroll' | 'verify'

/**
 * Pure: what must this admin session do before it may use the admin area?
 * - not required (or switched off by the emergency env var): allow
 * - session already proved a second factor (aal2): allow
 * - otherwise: verify with the authenticator they already enrolled, or enroll one first
 */
export function evaluateMfaGate(input: {
    required: boolean
    disabledByEnv: boolean
    currentLevel: string | null | undefined
    hasVerifiedFactor: boolean
}): MfaGate {
    if (!input.required || input.disabledByEnv) return 'allow'
    if (input.currentLevel === 'aal2') return 'allow'
    return input.hasVerifiedFactor ? 'verify' : 'enroll'
}

/**
 * Recovery switch: set ADMIN_2FA_DISABLE=true on the server and redeploy to turn
 * enforcement off if every admin has lost their authenticator.
 */
export function mfaDisabledByEnv(): boolean {
    return process.env.ADMIN_2FA_DISABLE === 'true'
}

const CACHE_MS = 10_000
let cached: { value: boolean; at: number } | null = null

export function clearMfaCache(): void {
    cached = null
}

/** Is two-factor enforced for the admin area? Fails open on a read error so a database blip cannot lock everyone out. */
export async function isMfaRequired(): Promise<boolean> {
    const now = Date.now()
    if (cached && now - cached.at < CACHE_MS) return cached.value
    try {
        const { data, error } = await (createServerClient() as any)
            .from('admin_settings')
            .select('value')
            .eq('key', MFA_SETTING_KEY)
            .maybeSingle()
        if (error) throw error
        const value = data?.value === 'true'
        cached = { value, at: now }
        return value
    } catch (e: any) {
        console.error('[mfa] could not read the 2FA setting, not enforcing:', e?.message)
        return false
    }
}
