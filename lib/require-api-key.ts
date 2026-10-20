import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getTrustedClientIp } from '@/lib/rate-limit'
import { parseBearerKey, hashApiKey } from '@/lib/api-keys'
import type { UserRole } from '@/lib/roles'
import { rememberKey } from '@/lib/api-usage'

export interface ApiKeyAuth {
  keyId: string
  user: { id: string; role: UserRole }
  wallet: { id: string; balance: number }
  supabase: ReturnType<typeof createServerClient>
}

function err(error: string, code: string, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json({ error, code }, { status, headers: extraHeaders })
}

export async function requireApiKey(request: Request): Promise<ApiKeyAuth | NextResponse> {
  const ip = getTrustedClientIp(request)

  // 1. Pre-auth IP throttle: bounds anonymous floods AND online key-guessing
  //    (every request counts, valid or not; 256-bit keys make this ample).
  const ipLimit = await checkRateLimit(`apikey-ip:${ip}`, 30, 60)
  if (!ipLimit.allowed) return err('Too many requests', 'rate_limited', 429, { 'Retry-After': String(ipLimit.retryAfterSeconds) })

  // 2. Strict header parse + reject key in query string.
  const url = new URL(request.url)
  if (url.searchParams.has('api_key') || url.searchParams.has('apikey')) {
    return err('API key must be sent in the Authorization header, not the query string', 'key_in_query', 400)
  }
  const presented = parseBearerKey(request.headers.get('authorization'))
  if (!presented) return err('Missing or malformed API key', 'unauthorized', 401)

  // 3. Hash + lookup (service-role). Fail CLOSED: DB error => 503, not allow.
  const supabase = createServerClient()
  const { data: key, error: lookupError } = await (supabase
    .from('api_keys') as any)
    .select('id, user_id, status, rate_limit_per_min')
    .eq('key_hash', hashApiKey(presented))
    .maybeSingle()

  if (lookupError) return err('Auth service unavailable', 'auth_unavailable', 503)
  if (!key || key.status !== 'active') return err('Invalid API key', 'unauthorized', 401)
  rememberKey(request, key.id) // lets withApiUsage count this call once the status is known

  // 4. Load owner role + wallet.
  const { data: user, error: userError } = await (supabase.from('users') as any)
    .select('id, role').eq('id', key.user_id).maybeSingle()
  const { data: wallet, error: walletError } = await (supabase.from('wallets') as any)
    .select('id, balance').eq('user_id', key.user_id).maybeSingle()
  if (userError || walletError) return err('Auth service unavailable', 'auth_unavailable', 503)
  if (!user || !wallet) return err('Account not provisioned', 'account_error', 500)

  // 5. Per-key rate limit.
  const keyLimit = await checkRateLimit(`apikey:${key.id}`, key.rate_limit_per_min, 60)
  if (!keyLimit.allowed) return err('Rate limit exceeded', 'rate_limited', 429, { 'Retry-After': String(keyLimit.retryAfterSeconds) })

  // 6. Best-effort last_used_at.
  void (supabase.from('api_keys') as any).update({ last_used_at: new Date().toISOString() }).eq('id', key.id)

  return { keyId: key.id, user: { id: user.id, role: user.role }, wallet: { id: wallet.id, balance: Number(wallet.balance) }, supabase }
}
