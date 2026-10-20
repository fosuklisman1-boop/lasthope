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

        // Delete orders older than 14 days
        const { data, error, count } = await (supabase
            .from('orders') as any)
            .delete()
            .lt('created_at', fourteenDaysAgo.toISOString())
            .select('id', { count: 'exact' })

        if (error) throw error

        console.log(`Deleted ${count || 0} orders older than 14 days`)

        return NextResponse.json({
            success: true,
            deleted: count || 0,
            cutoffDate: fourteenDaysAgo.toISOString()
        })
    } catch (error) {
        console.error('Cron delete-old-orders error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export const GET = withCronRun('delete-old-orders', handleGET)
