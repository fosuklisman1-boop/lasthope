import { NextRequest, NextResponse } from 'next/server'
import { withCronRun } from '@/lib/cron-runs'
import { isCronAuthorized } from "@/lib/cron-auth"
import { createServerClient } from '@/lib/supabase'

async function handleGET(request: NextRequest) {
    // Verify cron secret
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServerClient()

    try {
        // Calculate date 14 days ago
        const fourteenDaysAgo = new Date()
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

        // Delete orders older than 14 days. The database function moves each shop's paid profit into
        // the profit ledger in the same statement, so cleaning up history never lowers a shop's balance.
        const { data: count, error } = await (supabase as any).rpc('archive_old_orders', { p_cutoff: fourteenDaysAgo.toISOString() })

        if (error) throw error

        console.log(`Deleted ${Number(count) || 0} orders older than 14 days`)

        return NextResponse.json({
            success: true,
            deleted: Number(count) || 0,
            cutoffDate: fourteenDaysAgo.toISOString()
        })
    } catch (error) {
        console.error('Cron delete-old-orders error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export const GET = withCronRun('delete-old-orders', handleGET)
