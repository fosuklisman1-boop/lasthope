import { createServerClient } from '@/lib/supabase'

export interface CronJobConfig {
    job: string
    label: string
    /** How often the external scheduler is expected to call it. */
    everyMinutes: number
}

export const CRON_JOBS: CronJobConfig[] = [
    { job: 'retry-webhooks', label: 'Retry webhooks', everyMinutes: 5 },
    { job: 'verify-pending-payments', label: 'Verify pending payments', everyMinutes: 10 },
    { job: 'alerts', label: 'Admin alerts', everyMinutes: 10 },
    { job: 'delete-old-orders', label: 'Delete old orders', everyMinutes: 1440 },
    { job: 'delete-old-complaints', label: 'Delete old complaints', everyMinutes: 1440 },
    { job: 'delete-old-notifications', label: 'Delete old notifications', everyMinutes: 1440 },
]

export interface CronRunRow {
    job: string
    last_started_at: string | null
    last_finished_at: string | null
    last_status: 'ok' | 'error' | null
    last_error: string | null
    last_duration_ms: number | null
    last_result: unknown
    runs_total: number
}

export type Freshness = 'ok' | 'late' | 'failing' | 'never'

const LATE_FACTOR = 2.5 // a job is late after missing about two runs
const MIN_LATE_MINUTES = 15

/** Pure: is this job healthy, late, failing, or has it never run? */
export function freshness(cfg: CronJobConfig, row: CronRunRow | null | undefined, now: Date = new Date()): { state: Freshness; minutesSince: number | null } {
    if (!row || !row.last_finished_at) return { state: 'never', minutesSince: null }
    const minutesSince = Math.max(0, Math.round((now.getTime() - new Date(row.last_finished_at).getTime()) / 60000))
    if (row.last_status === 'error') return { state: 'failing', minutesSince }
    const lateAfter = Math.max(MIN_LATE_MINUTES, cfg.everyMinutes * LATE_FACTOR)
    return { state: minutesSince > lateAfter ? 'late' : 'ok', minutesSince }
}

async function record(job: string, startedAt: Date, status: 'ok' | 'error', error: string | null, result: unknown) {
    try {
        const db = createServerClient() as any
        const { data: existing } = await db.from('cron_runs').select('runs_total').eq('job', job).maybeSingle()
        const finished = new Date()
        const trimmed = result === undefined ? null : JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === 'string' ? v.slice(0, 300) : v)))
        const { error: upsertError } = await db.from('cron_runs').upsert({
            job,
            last_started_at: startedAt.toISOString(),
            last_finished_at: finished.toISOString(),
            last_status: status,
            last_error: error ? error.slice(0, 500) : null,
            last_duration_ms: finished.getTime() - startedAt.getTime(),
            last_result: trimmed,
            runs_total: Number(existing?.runs_total ?? 0) + 1,
        })
        if (upsertError) console.error('[cron-runs] could not record', job, upsertError.message)
    } catch (e: any) {
        console.error('[cron-runs] unexpected failure recording', job, e?.message)
    }
}

/**
 * Wrap a cron route so the System page can show when it last ran and whether it worked.
 * Unauthorised calls (401) are not runs and are not recorded.
 */
export function withCronRun<R extends Request, A extends any[]>(
    job: string,
    handler: (request: R, ...rest: A) => Promise<Response>
): (request: R, ...rest: A) => Promise<Response> {
    return async (request, ...rest) => {
        const startedAt = new Date()
        let response: Response
        try {
            response = await handler(request, ...rest)
        } catch (e: any) {
            await record(job, startedAt, 'error', e?.message ?? 'Unhandled error', undefined)
            throw e
        }
        if (response.status === 401) return response

        let result: unknown
        try { result = await response.clone().json() } catch { result = undefined }
        const failed = !response.ok
        await record(job, startedAt, failed ? 'error' : 'ok', failed ? ((result as any)?.error ?? `HTTP ${response.status}`) : null, result)
        return response
    }
}
