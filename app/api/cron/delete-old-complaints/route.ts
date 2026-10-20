import { createServerClient } from '@/lib/supabase'
import { withCronRun } from '@/lib/cron-runs'
import { isCronAuthorized } from "@/lib/cron-auth"
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request) {
    try {
        if (!isCronAuthorized(request)) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        const supabase = createServerClient()

        // Calculate date 3 days ago
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

        // Delete old complaints
        const { count, error } = await (supabase
            .from('complaints') as any)
            .delete({ count: 'exact' })
            .lt('created_at', threeDaysAgo.toISOString())

        if (error) throw error

        return NextResponse.json({
            success: true,
            message: `Deleted ${count} old complaints`,
            deletedCount: count
        })
    } catch (error: any) {
        console.error('Error deleting old complaints:', error)
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }
}

export const GET = withCronRun('delete-old-complaints', handleGET)
