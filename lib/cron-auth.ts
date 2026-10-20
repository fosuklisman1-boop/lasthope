import crypto from 'crypto'

function safeEqual(got: string, expected: string): boolean {
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Cron auth for external schedulers. Accepts CRON_SECRET either as
 * `Authorization: Bearer <secret>` or as `?key=<secret>` (for schedulers that
 * cannot set headers). Fails closed when CRON_SECRET is unset.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') || ''
  if (safeEqual(header, `Bearer ${secret}`)) return true

  const key = new URL(request.url).searchParams.get('key') || ''
  return safeEqual(key, secret)
}
