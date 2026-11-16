import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-server'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { submitChargeOtp, PaystackChargeError } from '@/lib/paystack-charge'
import { PayError } from '@/lib/pay/errors'
import { assertOwner, type Caller } from '@/lib/pay/status'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function POST(request: NextRequest) {
  try {
    let body: any
    try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400) }
    const reference = typeof body?.reference === 'string' ? body.reference : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!reference || !code || code.length > 12) return json({ error: 'Reference and code are required' }, 400)

    const { data: { user } } = await createRouteClient().auth.getUser()
    const caller: Caller = { userId: user?.id, email: typeof body.email === 'string' ? body.email : undefined }

    const rl = await checkRateLimit(`pay-otp:${user?.id ?? getClientIp(request)}`, 10, 60)
    if (!rl.allowed) {
      return json({ error: 'Too many attempts. Please wait a moment and try again.' }, 429, { 'Retry-After': String(rl.retryAfterSeconds) })
    }

    await assertOwner(createServerClient() as any, reference, caller)
    const result = await submitChargeOtp({ reference, code })
    return json({ state: result.state })
  } catch (error) {
    if (error instanceof PayError) return json({ error: error.message }, error.httpStatus)
    if (error instanceof PaystackChargeError) return json({ error: error.message }, 502)
    console.error('[pay/otp] error:', error instanceof Error ? error.name : 'unknown')
    return json({ error: 'Internal server error' }, 500)
  }
}
