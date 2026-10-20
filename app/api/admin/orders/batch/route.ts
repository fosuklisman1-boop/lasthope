import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { setOrderStatus } from '@/lib/order-status'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const body = await request.json()
        const { orderIds, filename, network, idempotencyKey } = body

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: 'Order IDs are required' }, { status: 400 })
        }

        const { data: userData } = await supabase
            .from('users')
            .select('first_name')
            .eq('id', auth.userId)
            .single()

        // 0. Check for existing batch with idempotency key
        if (idempotencyKey) {
            const { data: existingBatch } = await supabase
                .from('download_batches')
                .select('id')
                .eq('idempotency_key', idempotencyKey)
                .single()

            if (existingBatch) {
                console.log(`[AdminBatchCreate] Returning existing batch for idempotency key: ${idempotencyKey}`)
                return NextResponse.json({
                    success: true,
                    batchId: (existingBatch as any).id,
                    updatedCount: orderIds.length,
                    isDuplicate: true
                })
            }
        }

        // 1. Check if any orders are already being downloaded (concurrent protection)
        const { data: existingOrders } = await supabase
            .from('orders')
            .select('id, status, download_batch_id')
            .in('id', orderIds)
            .neq('status', 'pending')

        if (existingOrders && existingOrders.length > 0) {
            console.log(`[AdminBatchCreate] ${existingOrders.length} orders already processing/downloaded`)
            return NextResponse.json({
                error: `${existingOrders.length} orders are already being processed by another admin`,
                alreadyProcessed: existingOrders.length
            }, { status: 409 })
        }

        // 2. Create batch record
        // Generate filename with admin name
        const adminName = userData?.first_name?.trim() || 'Admin'
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
        const generatedFilename = `lasthope_${adminName}_${timestamp}.xlsx`

        console.log('[BatchCreate] Generating filename:', { adminName, generatedFilename, receivedFilename: filename })

        const { data: batch, error: batchError } = await (supabase
            .from('download_batches') as any)
            .insert({
                filename: generatedFilename, // Always use generated filename with admin name
                network: network || 'Multiple',
                order_count: orderIds.length,
                idempotency_key: idempotencyKey
            })
            .select()
            .single()

        if (batchError) throw batchError

        // 3. Link orders to batch (download_batch_id assignment)
        const { error: updateError } = await (supabase
            .from('orders') as any)
            .update({
                download_batch_id: (batch as any).id,
            })
            .in('id', orderIds)

        if (updateError) throw updateError

        // 4. Mark each order as processing and enqueue webhook deliveries
        for (const id of orderIds) {
            await setOrderStatus(id, 'processing', {}, supabase)
        }

        await logAudit(auth, {
            action: 'order.batch',
            targetType: 'batch',
            targetId: String((batch as any).id),
            summary: `Created a download batch of ${orderIds.length} order(s)`,
            details: { filename: (batch as any).filename, network, count: orderIds.length },
        }, request)

        return NextResponse.json({
            success: true,
            batchId: (batch as any).id,
            filename: (batch as any).filename,
            updatedCount: orderIds.length
        })
    } catch (error: any) {
        console.error('Batch Creation Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
