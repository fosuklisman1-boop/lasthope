import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { processCompletedWalletPayment } from '@/lib/payments'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
    try {
        const secret = process.env.PAYSTACK_SECRET_KEY
        if (!secret) {
            console.error('PAYSTACK_SECRET_KEY is not defined')
            return NextResponse.json({ message: 'Server configuration error' }, { status: 500 })
        }

        // Get the raw body for signature verification
        const bodyValue = await request.text()

        // Verify signature
        const hash = crypto.createHmac('sha512', secret)
            .update(bodyValue)
            .digest('hex')

        const signature = request.headers.get('x-paystack-signature')

        if (hash !== signature) {
            return NextResponse.json({ message: 'Invalid signature' }, { status: 400 })
        }

        // Parse event
        const event = JSON.parse(bodyValue)

        // Handle charge.success
        if (event.event === 'charge.success') {
            const { reference, amount: paidAmountKobo, metadata } = event.data

            // Initialize Supabase client
            const supabase = createServerClient()

            // Check if this is an agent upgrade payment
            const isUpgrade = metadata?.upgrade_type === 'agent' || reference.startsWith('agent_upgrade_')

            if (isUpgrade) {
                console.log(`[Webhook] Identifying as AGENT UPGRADE (via ${metadata?.upgrade_type === 'agent' ? 'metadata' : 'reference prefix'})`)
                const { processCompletedUpgradePayment } = await import('@/lib/payments')
                const result = await processCompletedUpgradePayment(reference, event.data)

                if (!result.success) {
                    console.error('[Webhook] processCompletedUpgradePayment FAILED:', reference, result.error)
                } else {
                    console.log('[Webhook] processCompletedUpgradePayment SUCCESS:', reference)
                }

                return NextResponse.json({ received: true }, { status: 200 })
            }

            const isShopOrder = reference.startsWith('GST-')
            if (isShopOrder) {
                console.log(`[Webhook] Identifying as SHOP ORDER: ${reference}`)
                const { processCompletedShopOrder } = await import('@/lib/payments')
                const result = await processCompletedShopOrder(reference, event.data)

                if (!result.success) {
                    console.error('[Webhook] processCompletedShopOrder FAILED:', result.error)
                } else {
                    console.log('[Webhook] processCompletedShopOrder SUCCESS')
                }

                return NextResponse.json({ received: true }, { status: 200 })
            }

            // Regular wallet payment processing
            const { data: payment } = await supabase
                .from('wallet_payments')
                .select('total_amount, status')
                .eq('reference', reference)
                .single()

            if (!payment) {
                console.error('[Webhook] Payment reference not found:', reference)
                return NextResponse.json({ received: true }, { status: 200 })
            }

            // Verify amount
            const expectedAmountKobo = Math.round((payment as any).total_amount * 100)
            console.log(`[Webhook] Verifying amount for ${reference}: Expected ${expectedAmountKobo}, Received ${paidAmountKobo}`)

            if (paidAmountKobo !== expectedAmountKobo) {
                console.error(`[Webhook] AMOUNT MISMATCH for ${reference}. Expected: ${expectedAmountKobo}, Paid: ${paidAmountKobo}`)
                return NextResponse.json({ received: true }, { status: 200 })
            }

            // Process the payment safely
            console.log('[Webhook] Identified as REGULAR WALLET TOPUP')
            const result = await processCompletedWalletPayment(reference, event.data)

            if (!result.success && !result.alreadyProcessed) {
                console.error('[Webhook] processCompletedWalletPayment FAILED:', reference, result.error)
            } else {
                console.log('[Webhook] processCompletedWalletPayment SUCCESS/ALREADY_DONE:', reference)
            }
        }

        return NextResponse.json({ received: true }, { status: 200 })

    } catch (error) {
        console.error('Webhook processing error:', error)
        return NextResponse.json({ message: 'Internal server error' }, { status: 500 })
    }
}
