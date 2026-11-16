import { NextRequest, NextResponse } from 'next/server'
import { withCronRun } from '@/lib/cron-runs'
import { isCronAuthorized } from "@/lib/cron-auth"
import { createServerClient } from '@/lib/supabase'
import { verifyTransaction } from '@/lib/paystack-charge'
import {
    processCompletedWalletPayment,
    processCompletedUpgradePayment,
    processCompletedShopOrder,
    processCompletedDirectBuy,
} from '@/lib/payments'
import { runSweep } from '@/lib/pay/sweep-run'

// Safety-net sweep for payments the webhook and the /status poll did not finish:
// pending wallet_payments (WAL-/DBY-/upgrade_) and unpaid GST- orders. Rules live in
// lib/pay/sweep.ts. Not scheduled in vercel.json: an external scheduler calls it.
async function handleGET(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const supabase = createServerClient()
        const summary = await runSweep(supabase, {
            verify: verifyTransaction,
            complete: {
                topup: (ref, data) => processCompletedWalletPayment(ref, data),
                upgrade: (ref, data) => processCompletedUpgradePayment(ref, data),
                storefront: (ref, data) => processCompletedShopOrder(ref, data),
                direct_buy: (ref, data, sb) => processCompletedDirectBuy(ref, data, sb),
            },
        })
        return NextResponse.json({ success: true, ...summary })
    } catch (error) {
        console.error('Cron verify-pending-payments error:', error instanceof Error ? error.message : 'unknown')
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export const GET = withCronRun('verify-pending-payments', handleGET)
