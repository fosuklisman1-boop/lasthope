import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-server'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { PayError } from '@/lib/pay/errors'
import { getPaymentState, type Caller } from '@/lib/pay/status'
import { statusRateLimits } from '@/lib/pay/status-rate-limit'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function GET(request: NextRequest) {
  try {
    const reference = request.nextUrl.searchParams.get('reference') ?? ''
    const email = request.nextUrl.searchParams.get('email') ?? undefined
    if (!reference) return json({ error: 'Reference is required' }, 400)

    const { data: { user } } = await createRouteClient().auth.getUser()
    const caller: Caller = { userId: user?.id, email }

    // Guests are keyed by ip + reference (CGNAT-safe) with a looser per-IP ceiling; users by id.
    for (const bucket of statusRateLimits({ userId: user?.id, ip: getClientIp(request), reference })) {
      const rl = await checkRateLimit(bucket.key, bucket.max, bucket.windowSeconds)
      if (!rl.allowed) {
        return json({ error: 'Too many requests. Please slow down.' }, 429, { 'Retry-After': String(rl.retryAfterSeconds) })
      }
    }

    const result = await getPaymentState(createServerClient() as any, reference, caller)
    return json(result)
  } catch (error) {
    if (error instanceof PayError) return json({ error: error.message }, error.httpStatus)
    console.error('[pay/status] error:', error instanceof Error ? error.name : 'unknown')
    return json({ error: 'Internal server error' }, 500)
  }
}
