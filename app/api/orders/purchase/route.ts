import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { sendOrderSuccessEmail, sendAdminNewOrderAlert } from '@/lib/email-service'
import { sendOrderSuccessSMS, sendAdminAgentOrderAlert } from '@/lib/sms-service'
import { placeOrder, normalizeGhanaPhone } from '@/lib/orders'
import { randomUUID } from 'crypto'

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

        // Check if phone is blacklisted (normalize to E.164 first so +233... and 0... match the same row)
        const normalizedPhone = normalizeGhanaPhone(phoneNumber) ?? phoneNumber
        const { data: blacklisted } = await (supabase as any)
            .from('phone_blacklist')
            .select('id')
            .eq('phone_number', normalizedPhone)
            .single()

        if (blacklisted) {
            return NextResponse.json({ error: 'This phone number is not allowed' }, { status: 400 })
        }

        // Delegate the entire money path to the shared placeOrder service (debit-first)
        const result = await placeOrder(
            {
                userId,
                packageId,
                phoneNumber,
                idempotencyKey: idempotencyKey || randomUUID(),
                source: 'purchase',
            },
            supabase,
        )

        if (!result.ok) {
            return NextResponse.json({ error: result.message }, { status: result.httpStatus })
        }

        // Update customer purchases
        await updateCustomerPurchases(supabase, userId!, phoneNumber, result.price)

        // Create notification
        await (supabase.from('notifications') as any).insert({
            user_id: userId,
            title: 'Order Placed',
            message: `Your order for ${result.size} to ${phoneNumber} has been placed and is being processed.`,
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
                const isAgent = userRole === 'agent'

                // Fetch current wallet balance for SMS notification
                let newBalance: number | undefined
                const { data: walletData } = await supabase
                    .from('wallets')
                    .select('balance')
                    .eq('user_id', userId)
                    .single()
                if (walletData) {
                    newBalance = (walletData as any).balance
                }

                // Send order success email to user (skip for admin/sub-admin)
                const isAdminUser = userRole === 'admin' || userRole === 'sub-admin'
                if (!isAdminUser) {
                    sendOrderSuccessEmail(
                        userEmail,
                        firstName,
                        {
                            referenceCode: result.reference,
                            phoneNumber,
                            network: result.network,
                            size: result.size,
                            price: result.price,
                        }
                    ).catch((err: Error) => console.error('[Order] User email error:', err))
                }

                // Send order success SMS to account holder
                const accountHolderPhone = (userData as any).phone_number
                if (accountHolderPhone) {
                    sendOrderSuccessSMS(
                        accountHolderPhone,
                        {
                            network: result.network,
                            size: result.size,
                            price: result.price,
                            recipientNumber: phoneNumber,
                            currentBalance: newBalance ?? 0,
                        }
                    ).catch((err: Error) => console.error('[Order] SMS error:', err))
                }

                // Send agent-specific admin SMS alert
                if (isAgent) {
                    sendAdminAgentOrderAlert()
                        .catch((err: Error) => console.error('[Order] Agent Admin SMS alert error:', err))
                }

                // Send new order alert to admin
                sendAdminNewOrderAlert({
                    referenceCode: result.reference,
                    phoneNumber,
                    network: result.network,
                    size: result.size,
                    price: result.price,
                    customerName: `${firstName} ${lastName}`.trim(),
                    customerEmail: userEmail,
                }).catch((err: Error) => console.error('[Order] Admin email error:', err))
            }
        } catch (emailError) {
            console.error('[Order] Failed to send email notification:', emailError)
        }

        return NextResponse.json({
            success: true,
            order: {
                id: result.orderId,
                reference_code: result.reference,
                status: result.status,
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
