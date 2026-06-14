import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ reference: string }> }
) {
    try {
        const { reference } = await params
        const supabase = createServerClient()

        const { data: order, error } = await supabase
            .from('orders')
            .select(`
                *,
                shops (
                    name,
                    logo_url
                )
            `)
            .or(`reference.eq.${reference},reference_code.eq.${reference}`)
            .single()

        if (error || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        // Return only necessary public info for safety
        const publicOrder = {
            id: order.id,
            reference: order.reference || order.reference_code,
            network: order.network,
            size: order.size,
            amount: order.price || order.amount,
            status: order.status,
            payment_status: order.payment_status,
            phone_number: order.customer_phone || order.phone_number,
            created_at: order.created_at,
            shop_name: order.shops?.name || 'GHData Store'
        }

        return NextResponse.json({ order: publicOrder })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
