// Rate-limit buckets for GET /api/pay/status. Pure so it can be tested.
// The pay dialog polls every 3 s (20/min) per payment.

export const STATUS_PER_KEY_MAX = 60
/** Ceiling for all guest status checks from one IP (many guests can share a CGNAT IP). */
export const STATUS_GUEST_IP_MAX = 600
const WINDOW_SECONDS = 60
const MAX_REF_IN_KEY = 64

export interface RateBucket { key: string; max: number; windowSeconds: number }

export function statusRateLimits(i: { userId?: string; ip: string; reference: string }): RateBucket[] {
  if (i.userId) return [{ key: `pay-status:${i.userId}`, max: STATUS_PER_KEY_MAX, windowSeconds: WINDOW_SECONDS }]
  const ref = String(i.reference).slice(0, MAX_REF_IN_KEY)
  return [
    // Per payment: guests behind the same IP each get their own bucket.
    { key: `pay-status:${i.ip}:${ref}`, max: STATUS_PER_KEY_MAX, windowSeconds: WINDOW_SECONDS },
    // Per IP: rotating references cannot lift the limit without bound.
    { key: `pay-status-ip:${i.ip}`, max: STATUS_GUEST_IP_MAX, windowSeconds: WINDOW_SECONDS },
  ]
}
