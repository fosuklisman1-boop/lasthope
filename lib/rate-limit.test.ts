import { describe, it, expect, vi } from 'vitest'

// Prevent the top-level supabase client creation from failing in the test environment
vi.mock('./supabase', () => ({
  createServerClient: vi.fn(),
  supabase: {},
}))

import { getTrustedClientIp } from './rate-limit'

function req(headers: Record<string,string>) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Request
}

describe('getTrustedClientIp', () => {
  it('prefers x-vercel-forwarded-for over client x-forwarded-for', () => {
    expect(getTrustedClientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9')
  })
  it('falls back to x-real-ip, then unknown', () => {
    expect(getTrustedClientIp(req({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
    expect(getTrustedClientIp(req({}))).toBe('unknown')
  })
  it('ignores spoofed leftmost x-forwarded-for when a trusted header exists', () => {
    expect(getTrustedClientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': 'evil' }))).toBe('9.9.9.9')
  })
})
