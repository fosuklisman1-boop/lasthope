import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { processCompletedWalletPayment } from '@/lib/payments'
import crypto from 'crypto'
import { webhookStatusFor } from '@/lib/pay/webhook-outcome'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

/**
 * 200 acknowledges the event; 500 makes Paystack redeliver it. Transient
 * completion failures (and a DBY- 'pending') return 500 so a retry heals them;
 * completion is idempotent, so redelivery is safe.
 */
function ack(result: Parameters<typeof webhookStatusFor>[0]) {
    const status = webhookStatusFor(result)
    return status === 200
        ? NextResponse.json({ received: true }, { status })
        : NextResponse.json({ received: true, retry: true }, { status })
}

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

        const sigBuf = Buffer.from(signature || '', 'utf8')
        const hashBuf = Buffer.from(hash, 'utf8')
        const valid = hashBuf.length === sigBuf.length && crypto.timingSafeEqual(hashBuf, sigBuf)
        if (!valid) {
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
            // Not logged: metadata can carry customer data (phone numbers).
            const metadata = event.data.metadata

            const isUpgrade = metadata?.target_role || reference.startsWith('upgrade_') || metadata?.upgrade_type === 'agent' || reference.startsWith('agent_upgrade_')

            if (isUpgrade) {
                console.log(`[PaystackWebhook] Routing to Upgrade Process for ref: ${reference}`)
                const { processCompletedUpgradePayment } = await import('@/lib/payments')
                const result = await processCompletedUpgradePayment(reference, event.data)

                if (!result.success) {
                    console.error('[PaystackWebhook] processCompletedUpgradePayment FAILED:', result.error)
                } else {
                    console.log('[PaystackWebhook] processCompletedUpgradePayment SUCCESS')
                }

                return ack(result)
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

                return ack(result)
            }

            // Direct buy: credit the package price to the wallet (amount-checked
            // inside), then place the order keyed by the reference. Idempotent,
            // so this and the /api/pay/status poll can both run it.
            if (reference.startsWith('DBY-')) {
                if (typeof paidAmountKobo !== 'number') {
                    console.error('[PaystackWebhook] DBY event without amount, ignoring:', reference)
                    return NextResponse.json({ received: true }, { status: 200 })
                }
                const { processCompletedDirectBuy } = await import('@/lib/payments')
                const result = await processCompletedDirectBuy(reference, event.data, supabase)

                if (!result.success) {
                    console.error('[PaystackWebhook] processCompletedDirectBuy FAILED:', result.error)
                } else if (result.pending) {
                    console.log('[PaystackWebhook] processCompletedDirectBuy pending (credit not yet recorded):', reference)
                } else if (result.orderFailed) {
                    console.error('[PaystackWebhook] processCompletedDirectBuy paid but order not placed:', reference)
                } else {
                    console.log('[PaystackWebhook] processCompletedDirectBuy SUCCESS')
                }

                return ack(result)
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
            return ack(result)
        }

        return NextResponse.json({ received: true })
    } catch (error) {
        console.error('[PaystackWebhook] Webhook error:', error)
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
    }
}
