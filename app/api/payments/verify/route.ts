import { NextRequest, NextResponse } from 'next/server'
import { processCompletedWalletPayment } from '@/lib/payments'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const reference = searchParams.get('reference')
        const isInline = request.headers.get('accept')?.includes('application/json')

        if (!reference) {
            if (isInline) {
                return NextResponse.json({ success: false, error: 'No reference provided' }, { status: 400 })
            }
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?error=no_reference`)
        }

        // L4: throttle verify-callback abuse (reference probing / payment-spam)
        const rateLimit = await checkRateLimit(`payments-verify:${getClientIp(request)}`, 20, 60)
        if (!rateLimit.allowed) {
            if (isInline) {
                return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 })
            }
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?error=too_many_requests`)
        }

        // Verify with Paystack
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
            console.error('[PaymentVerify] Paystack verification failed:', paystackData)

            // Intelligent redirect based on reference
            const isUpgrade = reference.startsWith('upgrade_') || reference.startsWith('agent_upgrade_')
            const errorUrl = isUpgrade
                ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/upgrade?error=payment_failed`
                : `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?error=payment_failed`

            if (isInline) {
                return NextResponse.json({ success: false, error: 'Payment verification failed', url: errorUrl }, { status: 400 })
            }
            return NextResponse.redirect(errorUrl)
        }

        // Check for upgrade in metadata OR reference prefix (new pattern: target_role/upgrade_, legacy: upgrade_type/agent_upgrade_)
        const isUpgrade = paystackData.data.metadata?.target_role || reference.startsWith('upgrade_') || paystackData.data.metadata?.upgrade_type === 'agent' || reference.startsWith('agent_upgrade_')

        if (isUpgrade) {
            console.log(`[PaymentVerify] Routing to Upgrade Process for ref: ${reference}`)
            const { processCompletedUpgradePayment } = await import('@/lib/payments')
            const result = await processCompletedUpgradePayment(reference, paystackData.data)

            if (!result.success) {
                console.error('[PaymentVerify] processCompletedUpgradePayment FAILED:', result.error)
                if (isInline) return NextResponse.json({ success: false, error: result.error || 'Upgrade failed' }, { status: 500 })
                return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/upgrade?error=update_failed`)
            }

            console.log('[PaymentVerify] processCompletedUpgradePayment SUCCESS')
            if (isInline) return NextResponse.json({ success: true, message: 'Upgrade successful' })
            return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard/upgrade?success=true`)
        }

        // Regular wallet payment
        console.log('[PaymentVerify] Identified as REGULAR WALLET TOPUP')
        const { processCompletedWalletPayment } = await import('@/lib/payments')
        const result = await processCompletedWalletPayment(reference, paystackData.data)

        if (!result.success) {
            if (isInline) {
                return NextResponse.json({ success: false, error: result.error || 'Processing failed' }, { status: 500 })
            }
            return NextResponse.redirect(
                `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?error=${result.error || 'processing_failed'}`
            )
        }

        if (isInline) {
            return NextResponse.json({ success: true, message: 'Payment successful' })
        }
        return NextResponse.redirect(
            `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?success=true`
        )
    } catch (error) {
        console.error('[PaymentVerify] Verification error:', error)
        const isInline = request.headers.get('accept')?.includes('application/json')
        if (isInline) {
            return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 })
        }
        return NextResponse.redirect(
            `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/wallet?error=verification_failed`
        )
    }
}
