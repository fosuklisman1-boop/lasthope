import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const { searchParams } = new URL(request.url)
        const limit = parseInt(searchParams.get('limit') || '50')
        const offset = parseInt(searchParams.get('offset') || '0')
        const network = searchParams.get('network')
        const startDate = searchParams.get('startDate') // ISO string
        const endDate = searchParams.get('endDate') // ISO string
        const search = searchParams.get('search')

        // Deep Search: If search term provided, find batches containing matching orders
        let batchIdsFromSearch: string[] = []
        if (search) {
            const { data: matchingOrders } = await supabase
                .from('orders')
                .select('download_batch_id')
                .or(`phone_number.ilike.%${search}%,reference_code.ilike.%${search}%`)
                .not('download_batch_id', 'is', null)
                .limit(100)

            if (matchingOrders && matchingOrders.length > 0) {
                batchIdsFromSearch = [...new Set(matchingOrders.map((o: any) => o.download_batch_id))]
            } else {
                // If search yields no orders, return empty result immediately
                return NextResponse.json({ batches: [], totalCount: 0 })
            }
        }

        let query = supabase
            .from('download_batches')
            .select('*', { count: 'exact' })
            .gt('order_count', 0)

        if (batchIdsFromSearch.length > 0) {
            query = query.in('id', batchIdsFromSearch)
        }

        if (network && network !== 'all') {
            query = query.eq('network', network)
        }

        if (startDate) {
            query = query.gte('created_at', startDate)
        }
        if (endDate) {
            query = query.lte('created_at', endDate)
        }

        const { data: batches, count, error: fetchError } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (fetchError) {
            console.error('[AdminBatchesFetch] Error:', fetchError)
            throw fetchError
        }

        return NextResponse.json({
            batches: batches || [],
            totalCount: count || 0
        })
    } catch (error: any) {
        console.error('Admin Batches Fetch Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
