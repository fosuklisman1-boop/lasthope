import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { generateReferenceCode, calculatePaystackFee } from '@/lib/utils'
import { checkRateLimit } from '@/lib/rate-limit'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function POST(request: Request) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({
            // @ts-expect-error - auth-helpers types expect Promise but runtime needs synchronous object
            cookies: () => cookieStore
        })
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { plan = '30d' } = await request.json().catch(() => ({}));
        const user = session.user

        // L4: throttle upgrade-payment initialization (payment-spam protection)
        const rateLimit = await checkRateLimit(`upgrade-init:${user.id}`, 5, 60)
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: 'Too many payment attempts. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
            )
        }

        console.log('[UpgradeAPI] Received request for plan:', plan)
        console.log('[UpgradeAPI] User ID:', user.id)

        // Check if user is already an agent or admin
        const { data: dbUser } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single()

        console.log('[UpgradeAPI] DB User Role:', dbUser?.role)

        if (dbUser?.role !== 'user' && dbUser?.role !== 'agent') {
            console.error('[UpgradeAPI] Invalid role for upgrade:', dbUser?.role)
            return NextResponse.json(
                { error: `Membership upgrades are only available for customers and existing agents. Current role: ${dbUser?.role}` },
                { status: 400 }
            )
        }

        // Fetch upgrade prices from admin settings using service role to bypass RLS
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

        const { data: settings } = await supabaseAdmin
            .from('admin_settings')
            .select('key, value')
            .in('key', ['agent_upgrade_price_3d', 'agent_upgrade_price_14d', 'agent_upgrade_price_30d'])

        const getPrice = (key: string, def: number) => {
            const s = settings?.find((s: any) => s.key === key);
            return s ? Number(s.value) : def;
        };

        let upgradePrice = 100;
        let planLabel = 'Agent Status';

        if (plan === '3d') {
            upgradePrice = getPrice('agent_upgrade_price_3d', 9.99);
            planLabel = '3 Days Agent Pass';
        } else if (plan === '14d') {
            upgradePrice = getPrice('agent_upgrade_price_14d', 49.99);
            planLabel = '14 Days Agent Pass';
        } else {
            upgradePrice = getPrice('agent_upgrade_price_30d', 99.99);
            planLabel = '30 Days Agent Pass';
        }


        // No fees for membership payments - customer pays exact price
        const fee = 0
        const totalAmount = upgradePrice

        // Create a pending record in wallet_payments so the webhook can find it
        const reference = `agent_upgrade_${generateReferenceCode()}`

        // Get user's wallet
        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!wallet) {
            throw new Error('User wallet not found')
        }

        const planDays = plan === '3d' ? 3 : (plan === '14d' ? 14 : 30)

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
                    upgrade_type: 'agent',
                    plan_type: plan,
                    plan_days: planDays,
                    plan_label: planLabel,
                    base_amount: upgradePrice,
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
                amount: Math.round(totalAmount * 100), // Convert to pesewas
                reference,
                metadata: {
                    user_id: user.id,
                    upgrade_type: 'agent',
                    plan_type: plan,
                    plan_days: planDays,
                    plan_label: planLabel,
                    base_amount: upgradePrice,
                    fee: 0,
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
                    upgrade_type: 'agent',
                    plan_type: plan,
                    plan_days: planDays,
                    plan_label: planLabel,
                    base_amount: upgradePrice,
                    fee: 0,
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
        console.error('Error initializing agent upgrade:', error)
        return NextResponse.json(
            { error: error.message || 'Failed to initialize upgrade' },
            { status: 500 }
        )
    }
}
