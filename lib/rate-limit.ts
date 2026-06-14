import { createServerClient } from './supabase'

export interface RateLimitResult {
    allowed: boolean
    remaining: number
    retryAfterSeconds: number
}

/**
 * Atomically checks and increments a sliding-window rate-limit bucket via the
 * check_rate_limit RPC (SECURITY DEFINER, service_role only - see migration
 * rate_limit_buckets). Fails open (allows the request) if the check itself
 * errors, so a DB hiccup never blocks payments.
 */
export async function checkRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult> {
    const supabase = createServerClient()

    const { data, error } = await supabase
        .rpc('check_rate_limit', {
            p_key: key,
            p_max_attempts: maxAttempts,
            p_window_seconds: windowSeconds,
        })
        .single()

    if (error || !data) {
        console.error('[RateLimit] Check failed, allowing request:', error)
        return { allowed: true, remaining: maxAttempts, retryAfterSeconds: 0 }
    }

    const result = data as any
    return {
        allowed: result.allowed,
        remaining: result.remaining,
        retryAfterSeconds: result.retry_after_seconds,
    }
}

/** Best-effort client IP, for rate-limiting unauthenticated routes. */
export function getClientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0].trim()
    return request.headers.get('x-real-ip') || 'unknown'
}
