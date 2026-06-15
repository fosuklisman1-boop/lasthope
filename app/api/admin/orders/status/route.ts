import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { setOrderStatus } from '@/lib/order-status'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const body = await request.json()
        const { orderId, batchId, status } = body

        if (!status) {
            return NextResponse.json({ error: 'Status is required' }, { status: 400 })
        }

        if (!orderId && !batchId) {
            return NextResponse.json({ error: 'orderId or batchId is required' }, { status: 400 })
        }

        let affectedOrders: any[] = []

        if (orderId) {
            console.log(`[AdminStatusUpdate] Updating single order: ${orderId} to ${status}`)
            // Fetch single order - use regular join (outer) to include guest orders
            const { data: order, error: fetchError } = await supabase
                .from('orders')
                .select('id, user_id, reference_code, phone_number, network, download_batch_id, users(phone_number)')
                .eq('id', orderId)
                .single()

            if (fetchError) {
                console.error(`[AdminStatusUpdate] Fetch error for order ${orderId}:`, fetchError)
                throw fetchError
            }
            affectedOrders.push(order)

            // Check if order needs to be assigned to a batch
            let batchIdToAssign = (order as any).download_batch_id

            if (!batchIdToAssign) {
                // Create a new batch for this manually updated order
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
                const filename = `manual_action_${status}_${timestamp}.xlsx`

                const { data: newBatch, error: batchError } = await (supabase.from('download_batches') as any)
                    .insert({
                        filename: filename,
                        order_count: 1,
                        network: (order as any).network || 'Unknown'
                    })
                    .select()
                    .single()

                if (batchError) {
                    console.error(`[AdminStatusUpdate] Batch creation error:`, batchError)
                    // Don't fail the status update if batch creation fails
                } else {
                    batchIdToAssign = (newBatch as any).id
                    console.log(`[AdminStatusUpdate] Created new batch ${batchIdToAssign} for order ${orderId}`)
                }
            }

            // Update order status atomically (also merges download_batch_id and enqueues webhook deliveries)
            const newBatchId = batchIdToAssign && !(order as any).download_batch_id ? batchIdToAssign : null
            await setOrderStatus(orderId, status, { extra: newBatchId ? { download_batch_id: newBatchId } : {} }, supabase)
        } else if (batchId) {
            console.log(`[AdminStatusUpdate] Updating batch: ${batchId} to ${status}`)
            // Fetch orders in batch - use regular join (outer) to include guest orders
            const { data: orders, error: fetchError } = await supabase
                .from('orders')
                .select('id, user_id, reference_code, phone_number, status, payment_status, users(phone_number)')
                .eq('download_batch_id', batchId)

            if (fetchError) {
                console.error(`[AdminStatusUpdate] Fetch error for batch ${batchId}:`, fetchError)
                throw fetchError
            }

            // Filter out refunded orders - they should not be affected by batch updates
            const updatableOrders = (orders || []).filter(o => (o as any).payment_status !== 'refunded')
            affectedOrders = updatableOrders
            console.log(`[AdminStatusUpdate] Found ${affectedOrders.length} updatable orders in batch ${batchId} (excluding refunded)`)

            if (affectedOrders.length > 0) {
                for (const o of affectedOrders) {
                    await setOrderStatus((o as any).id, status, {}, supabase)
                }
            }
        }

        // Send notifications
        if (affectedOrders.length > 0) {
            const notifications = affectedOrders
                .filter(order => order && order.user_id) // Only notify registered users
                .map(order => ({
                    user_id: (order as any).user_id,
                    title: `Order ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                    message: `Your order ${(order as any).reference_code} has been marked as ${status}.`,
                    type: 'order_update',
                    action_url: `/dashboard/my-orders`,
                    is_read: false // Fixed: it should be 'is_read'
                }))

            if (notifications.length > 0) {
                const { error: notifyError } = await (supabase.from('notifications') as any).insert(notifications)
                if (notifyError) {
                    console.error('[AdminStatusUpdate] Notification insert error:', notifyError)
                }
            }
        }

        return NextResponse.json({
            success: true,
            updatedCount: affectedOrders.length
        })
    } catch (error: any) {
        console.error('Admin Status Update Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
