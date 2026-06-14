import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { processCompletedWalletPayment } from '@/lib/payments'
import crypto from 'crypto'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function POST(request: NextRequest) {
    try {
        const supabase = createServerClient()

        // Verify webhook signature
        const signature = request.headers.get('x-paystack-signature')
        const body = await request.text()

        const hash = crypto
            .createHmac('sha512', PAYSTACK_SECRET_KEY)
            .update(body)
            .digest('hex')

        if (hash !== signature) {
            console.error('[PaystackWebhook] Invalid webhook signature')
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }

        const event = JSON.parse(body)

        if (event.event === 'charge.success') {
            const { reference, amount: paidAmountKobo } = event.data

            // Identify the payment type from metadata/reference prefix BEFORE
            // looking up wallet_payments - GST- shop/guest orders have no
            // wallet_payments row at all, so checking that first caused
            // those orders to be silently skipped by this webhook (see M3).
            const metadata = event.data.metadata
            console.log(`[PaystackWebhook] Detected Metadata for ${reference}:`, metadata)

            const isUpgrade = metadata?.upgrade_type === 'agent' || reference.startsWith('agent_upgrade_')

            if (isUpgrade) {
                console.log(`[PaystackWebhook] Identifying as AGENT UPGRADE (via ${metadata?.upgrade_type === 'agent' ? 'metadata' : 'reference prefix'})`)
                const { processCompletedUpgradePayment } = await import('@/lib/payments')
                const result = await processCompletedUpgradePayment(reference, event.data)

                if (!result.success) {
                    console.error('[PaystackWebhook] processCompletedUpgradePayment FAILED:', result.error)
                } else {
                    console.log('[PaystackWebhook] processCompletedUpgradePayment SUCCESS')
                }

                return NextResponse.json({ received: true }, { status: 200 })
            }

            const isShopOrder = reference.startsWith('GST-')
            if (isShopOrder) {
                console.log(`[PaystackWebhook] Identifying as SHOP ORDER: ${reference}`)
                const { processCompletedShopOrder } = await import('@/lib/payments')
                const result = await processCompletedShopOrder(reference, event.data)

                if (!result.success) {
                    console.error('[PaystackWebhook] processCompletedShopOrder FAILED:', result.error)
                } else {
                    console.log('[PaystackWebhook] processCompletedShopOrder SUCCESS')
                }

                return NextResponse.json({ received: true }, { status: 200 })
            }

            // Regular wallet top-up: verify amount against the wallet_payments record
            const { data: payment } = await supabase
                .from('wallet_payments')
                .select('total_amount, status')
                .eq('reference', reference)
                .single()

            if (!payment) {
                console.error('[PaystackWebhook] Payment not found:', reference)
                return NextResponse.json({ received: true })
            }

            const expectedAmountKobo = Math.round((payment as any).total_amount * 100)
            console.log(`[PaystackWebhook] Verifying amount for ${reference}: Expected ${expectedAmountKobo}, Received ${paidAmountKobo}`)

            if (paidAmountKobo !== expectedAmountKobo) {
                console.error(`[PaystackWebhook] AMOUNT MISMATCH for ${reference}: Expected ${expectedAmountKobo}, got ${paidAmountKobo}`)
                return NextResponse.json({ received: true }, { status: 200 })
            }

            console.log('[PaystackWebhook] Identified as REGULAR WALLET TOPUP')
            const { processCompletedWalletPayment } = await import('@/lib/payments')
            const result = await processCompletedWalletPayment(reference, event.data)

            if (!result.success) {
                console.error('[PaystackWebhook] processCompletedWalletPayment FAILED:', result.error)
            } else {
                console.log('[PaystackWebhook] processCompletedWalletPayment SUCCESS')
            }
        }

        return NextResponse.json({ received: true })
    } catch (error) {
        console.error('[PaystackWebhook] Webhook error:', error)
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
    }
}
