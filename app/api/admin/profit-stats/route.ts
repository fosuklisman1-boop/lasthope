import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        // Fetch ALL orders except failed from ALL users
        let orderQuery = supabase
            .from('orders')
            .select('created_at, price, cost_price, network, size, status')
            .neq('status', 'failed')
            .order('created_at', { ascending: true })

        if (startDate) {
            orderQuery = orderQuery.gte('created_at', startDate)
        }
        if (endDate) {
            orderQuery = orderQuery.lte('created_at', endDate)
        }

        const { data: orders, error: ordersError } = await orderQuery

        if (ordersError) {
            console.error('[ProfitStats] Orders Error:', ordersError)
            throw ordersError
        }

        // Fetch all packages for cost lookup
        const { data: packages } = await supabase
            .from('data_packages')
            .select('network, size, price, cost_price')

        // Fetch all users to know who are admins
        const { data: users } = await supabase
            .from('users')
            .select('id, role') as any

        const adminIds = new Set((users || [])
            .filter((u: any) => u.role === 'admin' || u.role === 'sub-admin')
            .map((u: any) => u.id))

        // Fetch all wallet balances from wallets table
        const { data: wallets } = await supabase
            .from('wallets')
            .select('user_id, balance') as any

        // Filter out admin wallets and sum balances
        const regularWallets = (wallets || []).filter((w: any) => !adminIds.has(w.user_id))
        const userWalletTotal = regularWallets.reduce((sum: number, wallet: any) =>
            sum + (Number(wallet.balance) || 0), 0
        )

        return NextResponse.json({
            orders: orders || [],
            packages: packages || [],
            userWalletTotal,
            userCount: regularWallets.length,
            totalOrdersCount: orders?.length || 0
        })
    } catch (error: any) {
        console.error('Profit Stats Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
