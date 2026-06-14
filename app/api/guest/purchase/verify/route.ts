import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fulfillMTNOrder } from '@/lib/mtn-fulfillment'
import { fulfillOrder as fulfillOtherOrder } from '@/lib/at-ishare-service'
import { calculatePaystackFee } from '@/lib/utils'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const reference = searchParams.get('reference')

        if (!reference) {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=no_reference`)
        }

        // L4: throttle verify-callback abuse (reference probing / payment-spam)
        const rateLimit = await checkRateLimit(`guest-purchase-verify:${getClientIp(request)}`, 20, 60)
        if (!rateLimit.allowed) {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=too_many_requests`)
        }

        const supabase = createServerClient()

        // 1. Verify with Paystack
        const paystackResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                },
            }
        )

        const paystackData = await paystackResponse.json()

        if (!paystackData.status || paystackData.data.status !== 'success') {
            console.error('[GuestVerify] Paystack verification failed:', paystackData)
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=payment_failed`)
        }

        // 2. Get the guest order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('reference_code', reference)
            .single()

        if (orderError || !order) {
            console.error('[GuestVerify] Order not found:', reference)
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=order_not_found`)
        }

        // If already paid, just redirect to status tab
        if (order.payment_status === 'paid') {
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/s/order/${reference}`)
        }

        // 3. Verify the amount Paystack actually charged matches the order's
        // expected total (price + fee, see app/api/guest/purchase/initialize), M3.
        const expectedFee = calculatePaystackFee((order as any).price, 1.95)
        const expectedAmountKobo = Math.round(((order as any).price + expectedFee) * 100)
        const paidAmountKobo = paystackData.data.amount

        if (paidAmountKobo !== expectedAmountKobo) {
            console.error(`[GuestVerify] AMOUNT MISMATCH for order ${order.id} (${reference}): expected ${expectedAmountKobo}, got ${paidAmountKobo}`)
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=amount_mismatch`)
        }

        // 4. Mark as paid
        await (supabase.from('orders') as any)
            .update({
                payment_status: 'paid',
                updated_at: new Date().toISOString()
            })
            .eq('id', order.id)

        // 5. Trigger Fulfillment (Async)
        triggerGuestFulfillment(order.id, order.network!, order.phone_number, order.size!)

        // 6. Redirect to new guest order summary page
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/s/order/${reference}?success=true`)

    } catch (error) {
        console.error('[GuestVerify] Exception:', error)
        return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=verification_failed`)
    }
}

async function triggerGuestFulfillment(orderId: string, network: string, phoneNumber: string, size: string) {
    const supabase = createServerClient() // Uses service role by default in my lib/supabase if configured

    try {
        let result;
        if (network === 'MTN') {
            result = await fulfillMTNOrder(phoneNumber, size, orderId)
        } else {
            result = await fulfillOtherOrder(phoneNumber, size, network)
        }

        if (result.success) {
            await supabase
                .from('orders')
                .update({
                    status: 'processing',
                    provider_ref: (result as any).reference || (result as any).reference_id
                })
                .eq('id', orderId)
        }
    } catch (err) {
        console.error('[GuestFulfillment] Error:', err)
    }
}
