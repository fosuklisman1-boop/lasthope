// Pure phone helpers (no server/API imports) so client components can use them.
export function normalizeGhanaPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const d = raw.replace(/[^\d+]/g, '')
  let m: RegExpMatchArray | null
  if ((m = d.match(/^\+?233(\d{9})$/))) return '+233' + m[1]
  if ((m = d.match(/^0(\d{9})$/))) return '+233' + m[1]
  return null
}

export function toLocalPhone(raw: string): string | null {
  const n = normalizeGhanaPhone(raw)
  return n ? '0' + n.slice(4) : null
}
