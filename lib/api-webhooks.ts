import crypto from 'crypto'
import { resolveSafeWebhookTarget } from '@/lib/ssrf-guard'

export function signWebhook(timestamp: string, body: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function newWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(32).toString('base64url')
}

// Deliver one webhook. Returns the HTTP status (or 0 on network/SSRF failure).
// SSRF is re-checked here (send time) because DNS can rebind after save-time validation.
export async function deliverWebhook(url: string, secret: string, payload: object): Promise<number> {
  const target = await resolveSafeWebhookTarget(url)
  if (!target.ok) return 0 // blocked (SSRF/DNS) — treated as a failed attempt
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LASTHOPE-Signature': signWebhook(timestamp, body, secret),
        'X-LASTHOPE-Timestamp': timestamp,
      },
      body,
      redirect: 'manual',
      signal: controller.signal,
    })
    return res.status
  } catch { return 0 } finally { clearTimeout(timer) }
}
