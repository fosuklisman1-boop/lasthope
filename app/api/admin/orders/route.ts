import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const { searchParams } = new URL(request.url)
        const available = searchParams.get('available') === 'true'
        const batchId = searchParams.get('batchId')
        const batchIds = searchParams.get('batchIds')
        const limit = parseInt(searchParams.get('limit') || '50')
        const offset = parseInt(searchParams.get('offset') || '0')

        let query = supabase
            .from('orders')
            .select(`
                *,
                users (
                    first_name,
                    last_name,
                    email
                )
            `, { count: 'exact' })

        if (batchIds) {
            query = query.in('download_batch_id', batchIds.split(','))
        } else if (batchId) {
            query = query.eq('download_batch_id', batchId)
        } else if (available) {
            query = query
                .is('download_batch_id', null)
                .eq('status', 'pending')
                .eq('payment_status', 'paid')
        }

        const { data: orders, count, error: fetchError } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (fetchError) {
            console.error('[AdminOrdersFetch] Error:', fetchError)
            throw fetchError
        }

        // Since cost_price is now saved during purchase, most records will have it.
        // We remove the expensive server-side O(N^2) loop that was matching packages to orders.
        // This significantly reduces Fluid Active CPU usage.

        return NextResponse.json({
            orders: orders || [],
            totalCount: count || 0
        })
    } catch (error: any) {
        console.error('Admin Orders Fetch Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
