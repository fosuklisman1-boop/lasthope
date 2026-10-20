import { createServerClient } from '@/lib/supabase'

export const MAINTENANCE_KEY = 'payment_maintenance_mode'
const CACHE_MS = 5000

let cached: { value: boolean; at: number } | null = null

/** Test hook and used after an admin flips the switch, so the change is seen at once. */
export function clearMaintenanceCache(): void {
    cached = null
}

/**
 * Are payments paused? The admin switch (stored in admin_settings) decides, and the
 * old NEXT_PUBLIC_PAYMENT_MAINTENANCE_MODE=true environment variable still forces it on,
 * so an emergency redeploy flag keeps working. Fails open: a database hiccup must not
 * block payments.
 */
export async function isPaymentMaintenance(): Promise<boolean> {
    if (process.env.NEXT_PUBLIC_PAYMENT_MAINTENANCE_MODE === 'true') return true

    const now = Date.now()
    if (cached && now - cached.at < CACHE_MS) return cached.value

    try {
        const { data, error } = await (createServerClient() as any)
            .from('admin_settings')
            .select('value')
            .eq('key', MAINTENANCE_KEY)
            .maybeSingle()
        if (error) throw error
        const value = data?.value === 'true'
        cached = { value, at: now }
        return value
    } catch (e: any) {
        console.error('[maintenance] could not read the switch, allowing payments:', e?.message)
        return false
    }
}

export const MAINTENANCE_MESSAGE = 'Payment system is currently under maintenance. Please try again later.'
