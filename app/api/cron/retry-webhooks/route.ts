import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { createServerClient } from '@/lib/supabase'
import { deliverWebhook } from '@/lib/api-webhooks'

export const dynamic = 'force-dynamic'
const MAX_ATTEMPTS = 6
const BACKOFF_SEC = [60, 300, 900, 3600, 10800, 21600] // 1m,5m,15m,1h,3h,6h

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServerClient()
  const nowIso = new Date().toISOString()

  const { data: due, error: dueErr } = await (supabase.from('api_webhook_deliveries') as any)
    .select('id, api_key_id, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)            // exhausted rows are never re-picked
    .lte('next_attempt_at', nowIso)
    .limit(50)
  if (dueErr) return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  const rows = due || []

  // Batch-load keys for all due rows (avoid N+1).
  const keyIds = [...new Set(rows.map((r: any) => r.api_key_id))]
  const keyMap = new Map<string, any>()
  if (keyIds.length) {
    const { data: keys } = await (supabase.from('api_keys') as any)
      .select('id, webhook_url, webhook_secret, status').in('id', keyIds)
    for (const k of keys || []) keyMap.set(k.id, k)
  }

  let delivered = 0, failed = 0, skipped = 0
  for (const d of rows) {
    const key = keyMap.get(d.api_key_id)
    if (!key || key.status !== 'active' || !key.webhook_url) {
      skipped++
      // Terminal: bump attempts to MAX so the row is never re-picked.
      await (supabase.from('api_webhook_deliveries') as any)
        .update({ status: 'failed', attempts: MAX_ATTEMPTS, updated_at: nowIso }).eq('id', d.id)
      continue
    }
    const code = await deliverWebhook(key.webhook_url, key.webhook_secret, d.payload)
    const ok = code >= 200 && code < 300
    const attempts = d.attempts + 1
    if (ok) {
      delivered++
      await (supabase.from('api_webhook_deliveries') as any)
        .update({ status: 'delivered', attempts, last_response_code: code, updated_at: nowIso }).eq('id', d.id)
    } else {
      failed++
      const giveUp = attempts >= MAX_ATTEMPTS
      const next = new Date(Date.now() + (BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000)).toISOString()
      await (supabase.from('api_webhook_deliveries') as any)
        .update({ status: giveUp ? 'failed' : 'pending', attempts, last_response_code: code, next_attempt_at: next, updated_at: nowIso }).eq('id', d.id)
    }
  }
  return NextResponse.json({ processed: rows.length, delivered, failed, skipped })
}
