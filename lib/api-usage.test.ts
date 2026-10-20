import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }))

import { classifyStatus, rememberKey, recordUsage, withApiUsage } from './api-usage'
import { createServerClient } from '@/lib/supabase'

describe('classifyStatus', () => {
    it('counts successes as plain requests', () => {
        expect(classifyStatus(200)).toEqual({ requests: 1, errors: 0, rateLimited: 0 })
        expect(classifyStatus(201)).toEqual({ requests: 1, errors: 0, rateLimited: 0 })
    })
    it('counts 4xx and 5xx as errors', () => {
        expect(classifyStatus(400)).toEqual({ requests: 1, errors: 1, rateLimited: 0 })
        expect(classifyStatus(500)).toEqual({ requests: 1, errors: 1, rateLimited: 0 })
    })
    it('counts 429 as rate limited and not as an error', () => {
        expect(classifyStatus(429)).toEqual({ requests: 1, errors: 0, rateLimited: 1 })
    })
})

describe('recordUsage', () => {
    it('does nothing for a request that never reached a valid key', async () => {
        const rpc = vi.fn()
        ;(createServerClient as any).mockReturnValue({ rpc })
        await recordUsage(new Request('https://x.test'), new Response(null, { status: 401 }))
        expect(rpc).not.toHaveBeenCalled()
    })

    it('bumps the counters for the remembered key', async () => {
        const rpc = vi.fn().mockResolvedValue({ error: null })
        ;(createServerClient as any).mockReturnValue({ rpc })
        const req = new Request('https://x.test')
        rememberKey(req, 'key-1')
        await recordUsage(req, new Response(null, { status: 429 }))
        expect(rpc).toHaveBeenCalledWith('bump_api_key_usage', { p_key: 'key-1', p_requests: 1, p_errors: 0, p_limited: 1 })
    })

    it('never throws even if the database call fails', async () => {
        const rpc = vi.fn().mockRejectedValue(new Error('db down'))
        ;(createServerClient as any).mockReturnValue({ rpc })
        const req = new Request('https://x.test')
        rememberKey(req, 'key-1')
        await expect(recordUsage(req, new Response(null, { status: 200 }))).resolves.toBeUndefined()
    })
})

describe('withApiUsage', () => {
    it('returns the handler response unchanged and counts it', async () => {
        const rpc = vi.fn().mockResolvedValue({ error: null })
        ;(createServerClient as any).mockReturnValue({ rpc })
        const handler = vi.fn(async (req: Request) => {
            rememberKey(req, 'key-2')
            return new Response('ok', { status: 200 })
        })
        const res = await withApiUsage(handler)(new Request('https://x.test'))
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('ok')
        expect(rpc).toHaveBeenCalledWith('bump_api_key_usage', expect.objectContaining({ p_key: 'key-2', p_requests: 1 }))
    })
})
