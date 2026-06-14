import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({ 
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore 
        })
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Get user's shop IDs
        const { data: shops } = await supabase
            .from('shops')
            .select('id')
            .eq('user_id', session.user.id)
        
        const shopIds = shops?.map(s => s.id) || []

        if (shopIds.length === 0) {
            return NextResponse.json({ orders: [] })
        }

        // 2. Fetch orders for these shops
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .in('shop_id', shopIds)
            .order('created_at', { ascending: false })

        if (error) throw error

        return NextResponse.json({ orders: orders || [] })
    } catch (error: any) {
        console.error('[ShopOrdersAPI] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
