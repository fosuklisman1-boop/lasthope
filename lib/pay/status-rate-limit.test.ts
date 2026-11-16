import { describe, it, expect } from 'vitest'
import { statusRateLimits, STATUS_PER_KEY_MAX, STATUS_GUEST_IP_MAX } from './status-rate-limit'

describe('statusRateLimits', () => {
  it('authed users are keyed by user id only (unchanged)', () => {
    expect(statusRateLimits({ userId: 'u1', ip: '1.2.3.4', reference: 'WAL-1' })).toEqual([
      { key: 'pay-status:u1', max: STATUS_PER_KEY_MAX, windowSeconds: 60 },
    ])
  })
  it('guests are keyed by ip + reference, so guests sharing an IP (CGNAT) do not share a bucket', () => {
    const a = statusRateLimits({ ip: '1.2.3.4', reference: 'GST-A' })
    const b = statusRateLimits({ ip: '1.2.3.4', reference: 'GST-B' })
    expect(a[0]).toEqual({ key: 'pay-status:1.2.3.4:GST-A', max: STATUS_PER_KEY_MAX, windowSeconds: 60 })
    expect(a[0].key).not.toBe(b[0].key)
  })
  it('guests also get a looser IP-wide ceiling so rotating references cannot bypass the limit', () => {
    const [, ipWide] = statusRateLimits({ ip: '1.2.3.4', reference: 'GST-A' })
    expect(ipWide).toEqual({ key: 'pay-status-ip:1.2.3.4', max: STATUS_GUEST_IP_MAX, windowSeconds: 60 })
    // the dialog polls 20/min: per-key cap fits one dialog, ip cap fits many concurrent guests
    expect(STATUS_PER_KEY_MAX).toBe(60)
    expect(STATUS_GUEST_IP_MAX).toBeGreaterThanOrEqual(20 * 10)
  })
  it('bounds the reference length used in the key', () => {
    const [k] = statusRateLimits({ ip: 'x', reference: 'G'.repeat(500) })
    expect(k.key.length).toBeLessThanOrEqual('pay-status:x:'.length + 64)
  })
})
