import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { formatCurrency } from '@/lib/utils'

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

        // 1. Get withdrawal history
        const { data: withdrawals, error: wError } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })

        if (wError) throw wError

        // 2. Calculate total earnings (sum of profit_amount from completed orders via user's shop)
        // First get shop(s) for the user
        const { data: shops } = await supabase
            .from('shops')
            .select('id')
            .eq('user_id', session.user.id)
        
        const shopIds = shops?.map(s => s.id) || []

        let totalEarnings = 0
        if (shopIds.length > 0) {
            const { data: orders } = await supabase
                .from('orders')
                .select('profit_amount')
                .in('shop_id', shopIds)
                .eq('payment_status', 'paid')
            
            totalEarnings = orders?.reduce((acc, curr) => acc + (Number(curr.profit_amount) || 0), 0) || 0
        }

        // 3. Calculate already withdrawn (approved)
        const totalWithdrawn = withdrawals
            ?.filter(w => w.status === 'approved')
            .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0
        
        // 4. Calculate pending withdrawals
        const pendingAmount = withdrawals
            ?.filter(w => w.status === 'pending')
            .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0

        return NextResponse.json({
            withdrawals,
            stats: {
                totalEarnings,
                totalWithdrawn,
                pendingAmount,
                availableBalance: totalEarnings - totalWithdrawn
            }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
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

        const body = await request.json()
        const { amount, paymentMethod, paymentDetails } = body

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
        }

        // 1. Double check available balance server-side
        const { data: shops } = await supabase.from('shops').select('id').eq('user_id', session.user.id)
        const shopIds = shops?.map(s => s.id) || []
        
        let totalEarnings = 0
        if (shopIds.length > 0) {
            const { data: orders } = await supabase
                .from('orders')
                .select('profit_amount')
                .in('shop_id', shopIds)
                .eq('payment_status', 'paid')
            totalEarnings = orders?.reduce((acc, curr) => acc + (Number(curr.profit_amount) || 0), 0) || 0
        }

        const { data: withdrawals } = await supabase
            .from('withdrawals')
            .select('amount, status')
            .eq('user_id', session.user.id)
            .in('status', ['approved', 'pending'])
        
        const hasPending = withdrawals?.some(w => w.status === 'pending')
        if (hasPending) {
            return NextResponse.json({
                error: 'You already have a pending withdrawal request. Please wait for it to be processed.'
            }, { status: 400 })
        }
        const committedAmount = withdrawals?.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0
        const available = totalEarnings - committedAmount

        if (amount > available) {
            const currentPending = withdrawals?.filter(w => w.status === 'pending').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 0
            return NextResponse.json({ 
                error: currentPending > 0 
                    ? `Insufficient balance. You have ${formatCurrency(currentPending)} in pending requests.`
                    : 'Insufficient earnings balance' 
            }, { status: 400 })
        }

        // 2. Create withdrawal request
        // The DB enforces "one pending withdrawal per user" via a unique index
        // (withdrawals_one_pending_per_user), so a concurrent request that slips
        // past the hasPending check above is rejected here instead (M4).
        const { data, error } = await supabase
            .from('withdrawals')
            .insert({
                user_id: session.user.id,
                amount,
                payment_method: paymentMethod,
                payment_details: paymentDetails,
                status: 'pending'
            })
            .select()
            .single()

        if (error) {
            if (error.code === '23505') {
                return NextResponse.json({
                    error: 'You already have a pending withdrawal request. Please wait for it to be processed.'
                }, { status: 400 })
            }
            throw error
        }

        return NextResponse.json({ success: true, withdrawal: data })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
