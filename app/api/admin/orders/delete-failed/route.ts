import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const body = await request.json()
        const { batchId } = body

        if (!batchId) {
            return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
        }

        // 1. Get all orders in this batch that are failed
        const { data: batchOrders, error: ordersError } = await supabase
            .from('orders')
            .select('id, user_id, status, price')
            .eq('download_batch_id', batchId)
            .eq('status', 'failed')

        if (ordersError) throw ordersError

        if (!batchOrders || batchOrders.length === 0) {
            return NextResponse.json({ error: 'No failed orders found in this batch' }, { status: 404 })
        }

        const orderIds = batchOrders.map((o: any) => o.id)
        const failedOrderCount = batchOrders.length

        // 2. Delete the failed orders
        const { error: deleteError } = await supabase
            .from('orders')
            .delete()
            .in('id', orderIds)

        if (deleteError) throw deleteError

        // 3. Update batch order_count
        const { error: batchUpdateError } = await (supabase
            .from('download_batches') as any)
            .update({ order_count: 0 })
            .eq('id', batchId)

        if (batchUpdateError) throw batchUpdateError

        // 4. Optionally delete the batch if no orders left
        const { error: batchDeleteError } = await supabase
            .from('download_batches')
            .delete()
            .eq('id', batchId)

        if (batchDeleteError) console.error('Failed to delete batch:', batchDeleteError)

        await logAudit(auth, {
            action: 'order.delete_failed',
            targetType: 'batch',
            targetId: String(batchId),
            summary: `Deleted ${failedOrderCount} failed order(s) from a batch`,
            details: { count: failedOrderCount, orderIds },
        }, request)

        return NextResponse.json({
            success: true,
            deletedCount: failedOrderCount,
            message: `Deleted ${failedOrderCount} failed order(s)`
        })
    } catch (error: any) {
        console.error('Failed Order Deletion Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
