import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from "@/lib/cron-auth"
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
    // Verify cron secret
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServerClient()

    try {
        // Calculate date 24 hours ago
        const twentyFourHoursAgo = new Date()
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

        // Delete notifications older than 24 hours
        const { data, error, count } = await (supabase
            .from('notifications') as any)
            .delete()
            .lt('created_at', twentyFourHoursAgo.toISOString())
            .select('id', { count: 'exact' })

        if (error) throw error

        console.log(`Deleted ${count || 0} notifications older than 24 hours`)

        return NextResponse.json({
            success: true,
            deleted: count || 0,
            cutoffDate: twentyFourHoursAgo.toISOString()
        })
    } catch (error) {
        console.error('Cron delete-old-notifications error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
