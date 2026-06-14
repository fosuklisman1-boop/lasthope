import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { generateReferenceCode } from '@/lib/utils'
import { getPriceForRole } from '@/lib/pricing'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { sendOrderSuccessEmail, sendAdminNewOrderAlert } from '@/lib/email-service'
import { sendOrderSuccessSMS, sendAdminAgentOrderAlert } from '@/lib/sms-service'

export async function POST(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabaseUserClient = createRouteHandlerClient({
            // @ts-expect-error - auth-helpers types expect Promise but runtime needs synchronous object
            cookies: () => cookieStore
        })
        const { data: { session }, error: sessionError } = await supabaseUserClient.auth.getSession()

        if (sessionError || !session?.user) {
            console.error('Order API: Unauthorized - Session error or missing user:', sessionError?.message)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const user = session.user
        const userId = user.id

        let body;
        try {
            body = await request.json()
        } catch (e) {
            console.error('Order API: Failed to parse request body')
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
        }

        const { packageId, phoneNumber, idempotencyKey } = body

        // Service role client for privileged operations
        const supabase = createServerClient()

        // Idempotency check
        if (idempotencyKey) {
            const { data: existingOrder } = await supabase
                .from('orders')
                .select('id, reference_code, status')
                .eq('idempotency_key', idempotencyKey)
                .single()

            if (existingOrder) {
                console.log(`Idempotency hit: Returning existing order ${existingOrder.id}`)
                return NextResponse.json({
                    success: true,
                    order: {
                        id: existingOrder.id,
                        reference_code: existingOrder.reference_code,
                        status: existingOrder.status,
                    },
                })
            }
        }

        // Get package details
        const { data: pkg, error: pkgError } = await supabase
            .from('data_packages')
            .select('*')
            .eq('id', packageId)
            .eq('is_available', true)
            .single()

        if (pkgError || !pkg) {
            return NextResponse.json({ error: 'Package not found' }, { status: 404 })
        }

        // Check if phone is blacklisted
        const { data: blacklisted } = await (supabase as any)
            .from('phone_blacklist')
            .select('id')
            .eq('phone_number', phoneNumber)
            .single()

        if (blacklisted) {
            return NextResponse.json({ error: 'This phone number is not allowed' }, { status: 400 })
        }

        // Get user role for price calculation
        const { data: userRoleData } = await supabase
            .from('users')
            .select('role')
            .eq('id', userId)
            .single()

        const userRole = (userRoleData as any)?.role
        const isAgent = userRole === 'agent'

        // Determine price to charge based on user's reseller tier
        const chargeAmount = getPriceForRole(pkg as any, userRole)

        // Get user's wallet
        const { data: wallet, error: walletError } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userId)
            .single()

        if (walletError || !wallet) {
            return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
        }

        // Check balance
        if ((wallet as any).balance < chargeAmount) {
            return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
        }

        const referenceCode = generateReferenceCode()

        // Create order
        const { data: order, error: orderError } = await (supabase
            .from('orders') as any)
            .insert({
                user_id: userId,
                package_id: packageId,
                phone_number: phoneNumber,
                network: (pkg as any).network,
                size: (pkg as any).size,
                bundle_name: (pkg as any).size, // Compatibility
                price: chargeAmount,
                amount: chargeAmount, // Compatibility
                cost_price: (pkg as any).cost_price || 0,
                status: 'pending',
                payment_status: 'paid',
                reference_code: referenceCode,
                reference: referenceCode, // Compatibility
                fulfillment_method: 'auto',
                idempotency_key: idempotencyKey,
            })
            .select()
            .single()

        if (orderError) {
            console.error('Order creation error:', orderError)
            return NextResponse.json({
                error: 'Failed to create order',
                details: orderError.message,
                code: orderError.code,
                hint: orderError.hint
            }, { status: 500 })
        }

        // Debit wallet (atomic RPC - authoritative balance check, see M1)
        const { data: debitResult, error: debitError } = await supabase
            .rpc('debit_wallet', { p_wallet_id: (wallet as any).id, p_amount: chargeAmount })
            .single()

        if (debitError || !debitResult) {
            console.error('Wallet debit error:', debitError)
            // Rollback order
            await (supabase.from('orders') as any).delete().eq('id', (order as any).id)
            const insufficientBalance = debitError?.code === 'PGRST116'
            return NextResponse.json(
                { error: insufficientBalance ? 'Insufficient balance' : 'Failed to debit wallet' },
                { status: insufficientBalance ? 400 : 500 }
            )
        }

        const newBalance = (debitResult as any).balance

        // Create wallet transaction
        await (supabase.from('wallet_transactions') as any).insert({
            wallet_id: (wallet as any).id,
            user_id: userId,
            type: 'debit',
            amount: chargeAmount,
            description: `Data purchase: ${(pkg as any).size} for ${phoneNumber}`,
            reference: referenceCode,
            source: 'purchase',
            status: 'completed',
        })

        // Update customer purchases
        await updateCustomerPurchases(supabase, userId!, phoneNumber, chargeAmount)

        // Create notification
        await (supabase.from('notifications') as any).insert({
            user_id: userId,
            title: 'Order Placed',
            message: `Your order for ${(pkg as any).size} to ${phoneNumber} has been placed and is being processed.`,
            type: 'order_update',
            action_url: `/dashboard/my-orders`,
        })

        // Send order confirmation email to user and admin alert (async, non-blocking)
        try {
            // Get user details for email and SMS
            const { data: userData } = await supabase
                .from('users')
                .select('email, first_name, last_name, phone_number, role')
                .eq('id', userId)
                .single()

            if (userData) {
                const userEmail = (userData as any).email
                const firstName = (userData as any).first_name || 'Customer'
                const lastName = (userData as any).last_name || ''
                const userRole = (userData as any).role

                // Send order success email to user (skip for admin/sub-admin)
                const isAdminUser = userRole === 'admin' || userRole === 'sub-admin'
                if (!isAdminUser) {
                    sendOrderSuccessEmail(
                        userEmail,
                        firstName,
                        {
                            referenceCode,
                            phoneNumber,
                            network: (pkg as any).network,
                            size: (pkg as any).size,
                            price: chargeAmount
                        }
                    ).catch((err: Error) => console.error('[Order] User email error:', err))
                }

                // Send order success SMS to account holder
                const accountHolderPhone = (userData as any).phone_number
                if (accountHolderPhone) {
                    sendOrderSuccessSMS(
                        accountHolderPhone,
                        {
                            network: (pkg as any).network,
                            size: (pkg as any).size,
                            price: chargeAmount,
                            recipientNumber: phoneNumber,
                            currentBalance: newBalance
                        }
                    ).catch((err: Error) => console.error('[Order] SMS error:', err))
                }

                // Send new order alert to admin
                // Check if user is agent for SMS alert
                // We already checked userRoleData earlier
                if (isAgent) {
                    sendAdminAgentOrderAlert()
                        .catch((err: Error) => console.error('[Order] Agent Admin SMS alert error:', err))
                }

                // Send new order alert to admin
                sendAdminNewOrderAlert({
                    referenceCode,
                    phoneNumber,
                    network: (pkg as any).network,
                    size: (pkg as any).size,
                    price: chargeAmount,
                    customerName: `${firstName} ${lastName}`.trim(),
                    customerEmail: userEmail
                }).catch((err: Error) => console.error('[Order] Admin email error:', err))
            }
        } catch (emailError) {
            console.error('[Order] Failed to send email notification:', emailError)
        }

        return NextResponse.json({
            success: true,
            order: {
                id: (order as any).id,
                reference_code: referenceCode,
                status: 'pending',
            },
        })
    } catch (error: any) {
        console.error('Purchase error:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message,
            supabaseError: error.code
        }, { status: 500 })
    }
}

async function updateCustomerPurchases(
    supabase: any,
    userId: string,
    phoneNumber: string,
    amount: number
) {
    const { data: existing } = await supabase
        .from('customer_purchases')
        .select('*')
        .eq('user_id', userId)
        .eq('customer_phone', phoneNumber)
        .single()

    if (existing) {
        await supabase
            .from('customer_purchases')
            .update({
                total_purchases: existing.total_purchases + 1,
                total_spent: existing.total_spent + amount,
                last_purchase_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
    } else {
        await supabase.from('customer_purchases').insert({
            user_id: userId,
            customer_phone: phoneNumber,
            total_purchases: 1,
            total_spent: amount,
            first_purchase_at: new Date().toISOString(),
            last_purchase_at: new Date().toISOString(),
        })
    }
}
