import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { formatCurrency } from '@/lib/utils'
import { createServerClient } from '@/lib/supabase'
import { loadShopBalance, loadShopControls, loadShopLimits, limitsFor } from '@/lib/shop-data'

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({ 
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore 
        })
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Get withdrawal history
        const { data: withdrawals, error: wError } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })

        if (wError) throw wError

        // 2. Earnings: live paid-order profit plus the profit ledger (adjustments, reversals, archived profit)
        const svc = createServerClient() as any
        const { data: shops } = await supabase.from('shops').select('id').eq('user_id', user.id)
        const shopId = shops?.[0]?.id as string | undefined
        const balance = shopId ? await loadShopBalance(svc, shopId, user.id) : null
        const totalEarnings = balance?.totalEarnings ?? 0

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
                availableBalance: totalEarnings - totalWithdrawn,
                withdrawableBalance: balance ? balance.available : 0
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
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { amount, paymentMethod, paymentDetails } = body

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
        }

        // 1. Admin controls and the balance, server-side
        const svc = createServerClient() as any
        const { data: shops } = await supabase.from('shops').select('id').eq('user_id', user.id)
        const shopId = shops?.[0]?.id as string | undefined
        if (!shopId) return NextResponse.json({ error: 'You do not have a shop' }, { status: 400 })

        let controls, limits, balance
        try {
            ;[controls, limits, balance] = await Promise.all([
                loadShopControls(svc, shopId), loadShopLimits(svc), loadShopBalance(svc, shopId, user.id),
            ])
        } catch (e: any) {
            console.error('[withdrawals] controls failed:', e?.message)
            return NextResponse.json({ error: 'Withdrawals are temporarily unavailable. Please try again shortly.' }, { status: 503 })
        }
        if (controls.withdrawals_held) {
            return NextResponse.json({ error: 'Withdrawals on your shop are on hold. Please contact support.' }, { status: 403 })
        }
        const minWithdrawal = limitsFor(controls, limits).minWithdrawal
        if (minWithdrawal !== null && amount < minWithdrawal) {
            return NextResponse.json({ error: `The minimum withdrawal is ${formatCurrency(minWithdrawal)}.` }, { status: 400 })
        }
        const totalEarnings = balance.totalEarnings

        const { data: withdrawals } = await supabase
            .from('withdrawals')
            .select('amount, status')
            .eq('user_id', user.id)
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
                user_id: user.id,
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
