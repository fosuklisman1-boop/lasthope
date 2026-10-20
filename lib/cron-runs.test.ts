import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }))

import { freshness, withCronRun, CRON_JOBS, type CronRunRow } from './cron-runs'
import { createServerClient } from '@/lib/supabase'

const NOW = new Date('2026-10-20T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString()
const every5 = CRON_JOBS.find(j => j.job === 'retry-webhooks')!
const daily = CRON_JOBS.find(j => j.job === 'delete-old-orders')!

const row = (over: Partial<CronRunRow> = {}): CronRunRow => ({
    job: 'retry-webhooks', last_started_at: minsAgo(3), last_finished_at: minsAgo(3), last_status: 'ok',
    last_error: null, last_duration_ms: 120, last_result: null, runs_total: 10, ...over,
})

describe('freshness', () => {
    it('is never for a job with no record', () => {
        expect(freshness(every5, null, NOW).state).toBe('never')
        expect(freshness(every5, row({ last_finished_at: null }), NOW).state).toBe('never')
    })
    it('is ok shortly after a successful run', () => {
        expect(freshness(every5, row(), NOW)).toEqual({ state: 'ok', minutesSince: 3 })
    })
    it('is late once about two runs are missed, but not before', () => {
        expect(freshness(every5, row({ last_finished_at: minsAgo(14) }), NOW).state).toBe('ok') // floor of 15 minutes
        expect(freshness(every5, row({ last_finished_at: minsAgo(16) }), NOW).state).toBe('late')
        expect(freshness(daily, row({ last_finished_at: minsAgo(60 * 30) }), NOW).state).toBe('ok')
        expect(freshness(daily, row({ last_finished_at: minsAgo(60 * 61) }), NOW).state).toBe('late')
    })
    it('is failing when the last run errored, however recent', () => {
        expect(freshness(every5, row({ last_status: 'error' }), NOW).state).toBe('failing')
    })
})

function mockDb() {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const db = {
        from: vi.fn(() => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { runs_total: 4 } }) }) }),
            upsert,
        })),
    }
    ;(createServerClient as any).mockReturnValue(db)
    return upsert
}

describe('withCronRun', () => {
    it('records an ok run and returns the response untouched', async () => {
        const upsert = mockDb()
        const res = await withCronRun('retry-webhooks', async () => Response.json({ processed: 3 }))(new Request('https://x.test'))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ processed: 3 })
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ job: 'retry-webhooks', last_status: 'ok', runs_total: 5, last_result: { processed: 3 } }))
    })

    it('records an error run for a non-2xx response', async () => {
        const upsert = mockDb()
        await withCronRun('x', async () => Response.json({ error: 'query_failed' }, { status: 500 }))(new Request('https://x.test'))
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ last_status: 'error', last_error: 'query_failed' }))
    })

    it('does not record unauthorised calls', async () => {
        const upsert = mockDb()
        const res = await withCronRun('x', async () => Response.json({ error: 'Unauthorized' }, { status: 401 }))(new Request('https://x.test'))
        expect(res.status).toBe(401)
        expect(upsert).not.toHaveBeenCalled()
    })

    it('records a thrown error and rethrows it', async () => {
        const upsert = mockDb()
        await expect(withCronRun('x', async () => { throw new Error('boom') })(new Request('https://x.test'))).rejects.toThrow('boom')
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ last_status: 'error', last_error: 'boom' }))
    })
})
