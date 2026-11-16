const BLANK = '••••••••'

/** Masks a Ghana MoMo number for display ("024••••567"). Never echoes invalid input. */
export function maskMomoPhone(raw: string): string {
  let d = typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
  const m = d.match(/^233(\d{9})$/)
  if (m) d = '0' + m[1]
  if (!/^0\d{9}$/.test(d)) return BLANK
  return `${d.slice(0, 3)}••••${d.slice(-3)}`
}
