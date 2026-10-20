import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cron-auth'
import { withCronRun } from '@/lib/cron-runs'
import { runAlertChecks } from '@/lib/alert-runner'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request) {
    if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    try {
        return NextResponse.json(await runAlertChecks())
    } catch (e: any) {
        console.error('[cron/alerts] failed:', e)
        return NextResponse.json({ error: e.message || 'alert_check_failed' }, { status: 500 })
    }
}

export const GET = withCronRun('alerts', handleGET)
