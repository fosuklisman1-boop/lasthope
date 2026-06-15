import dns from 'dns/promises'
import net from 'net'

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number)
    if (o[0] === 10) return true
    if (o[0] === 127) return true
    if (o[0] === 0) return true
    if (o[0] === 169 && o[1] === 254) return true
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true
    if (o[0] === 192 && o[1] === 168) return true
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    if (l === '::1' || l === '::') return true
    if (l.startsWith('fc') || l.startsWith('fd')) return true
    if (l.startsWith('fe80')) return true
    if (l.startsWith('::ffff:')) return isPrivateIp(l.replace('::ffff:', ''))
    return false
  }
  return true
}

export function validateWebhookUrlShape(raw: string): { ok: boolean; reason?: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'invalid_url' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'must_be_https' }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) return { ok: false, reason: 'private_host' }
  if (net.isIP(host) && isPrivateIp(host)) return { ok: false, reason: 'private_ip' }
  return { ok: true }
}

export async function resolveSafeWebhookTarget(raw: string): Promise<{ ok: true; ip: string; url: URL } | { ok: false; reason: string }> {
  const shape = validateWebhookUrlShape(raw)
  if (!shape.ok) return { ok: false, reason: shape.reason! }
  const u = new URL(raw)
  let addrs: { address: string }[]
  try { addrs = await dns.lookup(u.hostname, { all: true }) } catch { return { ok: false, reason: 'dns_failed' } }
  if (!addrs.length) return { ok: false, reason: 'dns_empty' }
  for (const a of addrs) if (isPrivateIp(a.address)) return { ok: false, reason: 'resolves_to_private' }
  return { ok: true, ip: addrs[0].address, url: u }
}
