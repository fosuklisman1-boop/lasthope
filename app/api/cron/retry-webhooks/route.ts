import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServerClient } from '@/lib/supabase'
import { deliverWebhook } from '@/lib/api-webhooks'

export const dynamic = 'force-dynamic'
const MAX_ATTEMPTS = 6
const BACKOFF_SEC = [60, 300, 900, 3600, 10800, 21600] // 1m,5m,15m,1h,3h,6h

function authed(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(got), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServerClient()
  const nowIso = new Date().toISOString()
  const { data: due } = await (supabase.from('api_webhook_deliveries') as any)
    .select('id, api_key_id, payload, attempts').in('status', ['pending', 'failed']).lte('next_attempt_at', nowIso).limit(50)
  let delivered = 0, failed = 0
  for (const d of due || []) {
    const { data: key } = await (supabase.from('api_keys') as any).select('webhook_url, webhook_secret, status').eq('id', d.api_key_id).single()
    if (!key || key.status !== 'active' || !key.webhook_url) {
      await (supabase.from('api_webhook_deliveries') as any).update({ status: 'failed', updated_at: nowIso }).eq('id', d.id)
      continue
    }
    const code = await deliverWebhook(key.webhook_url, key.webhook_secret, d.payload)
    const ok = code >= 200 && code < 300
    const attempts = d.attempts + 1
    if (ok) { delivered++; await (supabase.from('api_webhook_deliveries') as any).update({ status: 'delivered', attempts, last_response_code: code, updated_at: nowIso }).eq('id', d.id) }
    else {
      failed++
      const giveUp = attempts >= MAX_ATTEMPTS
      const next = new Date(Date.now() + (BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000)).toISOString()
      await (supabase.from('api_webhook_deliveries') as any).update({ status: giveUp ? 'failed' : 'pending', attempts, last_response_code: code, next_attempt_at: next, updated_at: nowIso }).eq('id', d.id)
    }
  }
  return NextResponse.json({ processed: (due || []).length, delivered, failed })
}
