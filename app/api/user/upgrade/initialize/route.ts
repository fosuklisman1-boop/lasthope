import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { generateReferenceCode } from '@/lib/utils'
import { checkRateLimit } from '@/lib/rate-limit'
import { RESELLER_TIERS, isResellerRole } from '@/lib/roles'
import { isPaymentMaintenance, MAINTENANCE_MESSAGE } from '@/lib/maintenance'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function POST(request: Request) {
    try {
        if (await isPaymentMaintenance()) {
            return NextResponse.json({ error: MAINTENANCE_MESSAGE }, { status: 503 })
        }
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({
            // @ts-expect-error - auth-helpers types expect Promise but runtime needs synchronous object
            cookies: () => cookieStore
        })
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { tier } = await request.json().catch(() => ({}));

        // Validate tier
        if (!RESELLER_TIERS.includes(tier)) {
            return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
        }

        // L4: throttle upgrade-payment initialization (payment-spam protection)
        const rateLimit = await checkRateLimit(`upgrade-init:${user.id}`, 5, 60)
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: 'Too many payment attempts. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
            )
        }

        console.log('[UpgradeAPI] Received request for tier:', tier)
        console.log('[UpgradeAPI] User ID:', user.id)

        // Check eligibility: only customers and existing reseller tiers can upgrade
        const { data: dbUser } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single()

        console.log('[UpgradeAPI] DB User Role:', dbUser?.role)

        if (!(dbUser?.role === 'user' || isResellerRole(dbUser?.role))) {
            console.error('[UpgradeAPI] Invalid role for upgrade:', dbUser?.role)
            return NextResponse.json(
                { error: 'Upgrades are only available to customers and existing reseller tiers.' },
                { status: 400 }
            )
        }

        // Fetch upgrade price from admin settings using service role to bypass RLS
        const { createClient } = await import('@supabase/supabase-js')
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        const settingKey = 'upgrade_price_' + tier.replace(/-/g, '_')
        const { data: settingRow } = await supabaseAdmin
            .from('admin_settings').select('value').eq('key', settingKey).single()
        const upgradePrice = settingRow ? Number((settingRow as any).value) : 0
        if (!upgradePrice || upgradePrice <= 0) {
            return NextResponse.json({ error: 'Upgrade price not configured for ' + tier }, { status: 400 })
        }

        // No fees for membership payments - customer pays exact price
        const fee = 0
        const totalAmount = upgradePrice

        // Create a pending record in wallet_payments so the webhook can find it
        const reference = 'upgrade_' + generateReferenceCode()

        // Get user's wallet
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!wallet) {
            throw new Error('User wallet not found')
        }

        const { error: paymentError } = await (supabaseAdmin
            .from('wallet_payments') as any)
            .insert({
                user_id: user.id,
                wallet_id: (wallet as any).id,
                amount: upgradePrice,
                fee: 0,
                total_amount: upgradePrice,
                reference,
                provider: 'paystack',
                status: 'pending',
                metadata: {
                    user_id: user.id,
                    target_role: tier,
                }
            })

        if (paymentError) {
            console.error('[UpgradeInit] Database error:', paymentError)
            throw new Error('Failed to record payment attempt')
        }

        // Initialize Paystack payment
        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: user.email,
                amount: Math.round(upgradePrice * 100), // Convert to pesewas
                reference,
                metadata: {
                    user_id: user.id,
                    target_role: tier,
                },
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/verify?reference=${reference}`,
            }),
        })

        if (!paystackResponse.ok) {
            const errorData = await paystackResponse.json().catch(() => ({}));
            console.error('[UpgradeInit] Paystack initialize error:', errorData);

            // Update payment record to failed
            await supabaseAdmin
                .from('wallet_payments')
                .update({ status: 'failed', metadata: { error: errorData } })
                .eq('reference', reference);

            throw new Error('Failed to initialize payment');
        }

        const paystackData = await paystackResponse.json();

        if (!paystackData.status) {
            console.error('[UpgradeInit] Paystack status error:', paystackData);
            await supabaseAdmin
                .from('wallet_payments')
                .update({ status: 'failed', metadata: { error: paystackData } })
                .eq('reference', reference);
            throw new Error('Failed to create Paystack transaction');
        }

        // Update payment with Paystack's provider_reference
        const { error: updateRefError } = await supabaseAdmin
            .from('wallet_payments')
            .update({
                provider_reference: paystackData.data.reference,
                // Also store the full initialization response in metadata for debugging
                metadata: {
                    user_id: user.id,
                    target_role: tier,
                    init_response: paystackData.data
                }
            })
            .eq('reference', reference);

        if (updateRefError) {
            console.warn('[UpgradeInit] Failed to update provider_reference:', updateRefError);
            // We don't fail the request here, as the payment can still proceed via reference
        }

        return NextResponse.json({
            authorization_url: paystackData.data.authorization_url,
            reference,
            provider_reference: paystackData.data.reference
        })
    } catch (error: any) {
        console.error('Error initializing upgrade:', error)
        return NextResponse.json(
            { error: error.message || 'Failed to initialize upgrade' },
            { status: 500 }
        )
    }
}
