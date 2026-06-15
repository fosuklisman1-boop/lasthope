import crypto from 'crypto'

const KEY_RE = /^lh_live_[A-Za-z0-9_-]{43}$/

function pepper(): string {
  const p = process.env.API_KEY_PEPPER
  if (!p) throw new Error('API_KEY_PEPPER is not set')
  return p
}

export function hashApiKey(key: string): string {
  return crypto.createHmac('sha256', pepper()).update(key).digest('hex')
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(32).toString('base64url')
  const key = `lh_live_${random}`
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

export function parseBearerKey(authHeader: string | null | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null
  if (authHeader.includes(',')) return null
  const m = authHeader.match(/^Bearer (\S+)$/)
  if (!m) return null
  const key = m[1]
  return KEY_RE.test(key) ? key : null
}
