import { createServerClient } from './supabase'
import { sendWalletTopupSuccessEmail } from './email-service'
import { sendWalletTopupSuccessSMS, sendRoleUpgradeSuccessSMS } from './sms-service'
import { calculatePaystackFee } from './utils'
import { roleConfig } from '@/lib/roles'

// All GST- guest/shop orders are initialized with this fixed Paystack fee
// percentage (see app/api/guest/purchase/initialize/route.ts).
const GUEST_PAYSTACK_FEE_PERCENT = 1.95

export interface PaymentResult {
    success: boolean
    error?: string
    alreadyProcessed?: boolean
}

/**
 * Processes a completed payment by updating the status, 
 * crediting the wallet, logging the transaction, and notifying the user.
 * This is designed to be idempotent.
 */
export async function processCompletedWalletPayment(reference: string, providerMetadata?: any): Promise<PaymentResult> {
    const supabase = createServerClient()

    console.log(`[PaymentProcess] Starting Wallet Payment Process for ref: ${reference}`);

    // 1. Get payment record
    const { data: paymentData, error: paymentError } = await supabase
        .from('wallet_payments')
        .select('*')
        .eq('reference', reference)
        .single()

    const payment = paymentData as any

    if (paymentError || !payment) {
        console.error('[PaymentProcess] Payment not found for reference:', reference, paymentError);
        return { success: false, error: 'Payment not found' }
    }

    console.log(`[PaymentProcess] Found payment record. Current status: ${payment.status}, Metadata:`, payment.metadata);

    // Redirect to upgrade process if this is actually a role upgrade
    const isUpgrade = !!payment.metadata?.target_role || reference.startsWith('upgrade_') || reference.startsWith('agent_upgrade_')
    if (isUpgrade) {
        console.log('[PaymentProcess] Routing to Upgrade Process for ref:', reference)
        return processCompletedUpgradePayment(reference, providerMetadata)
    }

    // Verify the amount Paystack actually charged matches the payment's
    // expected total (amount + fee), so a wallet can't be credited for less.
    if (providerMetadata?.amount !== undefined && providerMetadata?.amount !== null) {
        const expectedKobo = Math.round(Number(payment.total_amount) * 100)
        if (providerMetadata.amount !== expectedKobo) {
            console.error(`[PaymentProcess] AMOUNT MISMATCH for ${reference}: expected ${expectedKobo}, got ${providerMetadata.amount}`)
            return { success: false, error: 'Amount mismatch' }
        }
    }

    // 2. Atomic Update (Idempotency Check)
    console.log(`[PaymentProcess] Attempting atomic status update to 'completed' for payment ${payment.id}...`);

    // Merge metadata to preserve original info (like upgrade_type) while adding provider data
    const mergedMetadata = {
        ...(typeof payment.metadata === 'object' ? payment.metadata : {}),
        provider_data: providerMetadata,
        processed_at: new Date().toISOString()
    };

    const { data: updatedPayment, error: updatePaymentError } = await (supabase
        .from('wallet_payments') as any)
        .update({
            status: 'completed',
            metadata: mergedMetadata,
            updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select()
        .single()

    if (updatePaymentError) {
        if (updatePaymentError.code === 'PGRST116') {
            console.log(`[PaymentProcess] Payment ${payment.id} already processed or not pending (code: PGRST116).`);
            return { success: true, alreadyProcessed: true }
        }
        console.error('[PaymentProcess] Update wallet_payments status error:', updatePaymentError)
        return { success: false, error: 'Failed to update payment status' }
    }

    if (!updatedPayment) {
        console.log(`[PaymentProcess] No row updated for payment ${payment.id}.`);
        return { success: true, alreadyProcessed: true }
    }

    console.log(`[PaymentProcess] Status update SUCCESSFUL for payment ${payment.id}. Crediting wallet...`);

    // 4. Credit wallet (atomic RPC - avoids read-then-write race, see M1)
    const { data: walletData, error: walletError } = await supabase
        .rpc('credit_wallet', { p_wallet_id: payment.wallet_id, p_amount: payment.amount })
        .single()

    const wallet = walletData as any

    if (walletError || !wallet) {
        console.error('[PaymentProcess] Credit wallet error:', payment.wallet_id, walletError)
        return { success: false, error: 'Failed to credit wallet' }
    }

    // 5. Create transaction record
    const { error: txnError } = await (supabase.from('wallet_transactions') as any).insert({
        wallet_id: payment.wallet_id,
        user_id: payment.user_id,
        type: 'credit',
        amount: payment.amount,
        description: 'Wallet top-up via Paystack',
        reference: reference,
        source: 'payment',
        status: 'completed',
    })

    if (txnError) {
        console.error('[PaymentProcess] Transaction log error:', txnError)
    }

    // 6. Create notification
    const { error: notifyError } = await (supabase.from('notifications') as any).insert({
        user_id: payment.user_id,
        title: 'Wallet Topped Up',
        message: `Your wallet has been credited with GHS ${payment.amount.toFixed(2)}`,
        type: 'payment_success',
        action_url: '/dashboard/wallet',
    })

    if (notifyError) {
        console.error('[PaymentProcess] Notification error:', notifyError)
    }

    // 7. Send email notification
    try {
        // Get user details for email
        const { data: userData } = await supabase
            .from('users')
            .select('email, first_name, phone_number')
            .eq('id', payment.user_id)
            .single()

        if (userData) {
            const newBalance = wallet.balance
            await sendWalletTopupSuccessEmail(
                (userData as any).email,
                (userData as any).first_name || 'Customer',
                payment.amount,
                reference,
                newBalance
            )

            // Send SMS notification
            if ((userData as any).phone_number) {
                console.log('[PaymentProcess] Found user phone:', (userData as any).phone_number)
                await sendWalletTopupSuccessSMS(
                    (userData as any).phone_number,
                    {
                        amount: payment.amount,
                        newBalance
                    }
                ).then(res => console.log('[PaymentProcess] SMS Result:', res))
                    .catch(err => console.error('[PaymentProcess] SMS error:', err))
            } else {
                console.warn('[PaymentProcess] No phone number found for user:', payment.user_id)
            }

        }
    } catch (emailError) {
        // Don't fail the payment process if email fails
        console.error('[PaymentProcess] Email notification error:', emailError)
    }

    return { success: true }
}

/**
 * Processes a completed upgrade payment by updating the user's role 
 * and extending their agent membership duration.
 */
export async function processCompletedUpgradePayment(reference: string, providerMetadata: any): Promise<PaymentResult> {
    const supabase = createServerClient()

    console.log(`[UpgradeProcess] Starting Upgrade Process for ref: ${reference}`);

    // 1. Get payment record
    const { data: paymentData, error: paymentError } = await supabase
        .from('wallet_payments')
        .select('*')
        .eq('reference', reference)
        .single()

    const payment = paymentData as any

    if (paymentError || !payment) {
        console.error('[UpgradeProcess] Payment not found for reference:', reference, paymentError);
        return { success: false, error: 'Payment not found' }
    }

    console.log(`[UpgradeProcess] Found payment record. ID: ${payment.id}, Current status: ${payment.status}`);

    // Verify the amount Paystack actually charged matches the payment's
    // expected total (amount + fee), so a role can't be granted for less.
    if (providerMetadata?.amount !== undefined && providerMetadata?.amount !== null) {
        const expectedKobo = Math.round(Number(payment.total_amount) * 100)
        if (providerMetadata.amount !== expectedKobo) {
            console.error(`[PaymentProcess] AMOUNT MISMATCH for ${reference}: expected ${expectedKobo}, got ${providerMetadata.amount}`)
            return { success: false, error: 'Amount mismatch' }
        }
    }

    // 2. Atomic Update (Idempotency Check)
    console.log(`[UpgradeProcess] Attempting atomic status update to 'completed' for payment ID: ${payment.id}, reference: ${reference}...`);
    console.log(`[UpgradeProcess] Condition: status = 'pending'`);

    // Merge metadata to preserve original info (like upgrade_type, plan_days)
    const mergedMetadata = {
        ...(typeof payment.metadata === 'object' ? payment.metadata : {}),
        provider_data: providerMetadata,
        processed_at: new Date().toISOString()
    };

    const { data: updatedPayment, error: updatePaymentError, status: httpStatus, statusText } = await (supabase
        .from('wallet_payments') as any)
        .update({
            status: 'completed',
            metadata: mergedMetadata,
            updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select()
        .single()

    if (updatePaymentError) {
        console.error('[UpgradeProcess] Update wallet_payments status call failed:', {
            error: updatePaymentError,
            httpStatus,
            statusText,
            paymentId: payment.id,
            currentStatus: payment.status
        });

        if (updatePaymentError.code === 'PGRST116') {
            console.log(`[UpgradeProcess] Payment ${payment.id} already processed or not pending (code: PGRST116).`);
            return { success: true, alreadyProcessed: true }
        }
        return { success: false, error: `Failed to update payment status: ${updatePaymentError.message}` }
    }

    if (!updatedPayment) {
        console.log(`[UpgradeProcess] No row updated for payment ${payment.id}.`);
        return { success: true, alreadyProcessed: true }
    }

    console.log(`[UpgradeProcess] Status update SUCCESSFUL. Proceeding with user upgrade...`);

    // 3. Get User details
    const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role, email, first_name, phone_number')
        .eq('id', payment.user_id)
        .single()

    const user = userData as any

    if (userError || !user) {
        console.error('[UpgradeProcess] User not found:', payment.user_id)
        return { success: false, error: 'User not found' }
    }

    const targetRole = (payment.metadata as any)?.target_role || 'agent'

    // 4. Update user role permanently (and activate account if suspended)
    const { error: updateUserError } = await (supabase
        .from('users') as any)
        .update({
            role: targetRole,
            status: 'active',
            updated_at: new Date().toISOString(),
        })
        .eq('id', payment.user_id)

    if (updateUserError) {
        console.error('[UpgradeProcess] Update user error:', updateUserError)
        return { success: false, error: 'Failed to update user role' }
    }

    // 5. Create notification
    await (supabase.from('notifications') as any).insert({
        user_id: payment.user_id,
        title: 'Upgrade Successful',
        message: `Congratulations! Your membership has been upgraded to ${targetRole}.`,
        type: 'system',
        action_url: '/dashboard',
    })

    // 6. Send SMS notification
    try {
        if (user.phone_number) {
            const { data: roleRow } = await (supabase as any).from('roles').select('label').eq('slug', targetRole).maybeSingle()
            const tierLabel = roleRow?.label || roleConfig[targetRole as keyof typeof roleConfig]?.label || targetRole
            await sendRoleUpgradeSuccessSMS(
                user.phone_number,
                user.first_name || 'Member',
                tierLabel,
            )
        }
    } catch (smsError) {
        console.error('[UpgradeProcess] SMS error:', smsError)
        // Don't fail the transaction if SMS fails
    }

    return { success: true }
}

/**
 * Processes a completed shop/storefront order.
 */
export async function processCompletedShopOrder(reference: string, providerMetadata: any): Promise<PaymentResult> {
    const supabase = createServerClient()

    console.log(`[ShopOrderProcess] Starting Shop Order Completion for ref: ${reference}`);

    // 1. Get order record and join with shop metadata
    const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
            *,
            shops (
                user_id,
                name
            )
        `)
        .eq('reference', reference)
        .single()

    if (orderError || !orderData) {
        console.error('[ShopOrderProcess] Order not found for reference:', reference, orderError);
        return { success: false, error: 'Order not found' }
    }

    const order = orderData as any
    console.log(`[ShopOrderProcess] Found order ID: ${order.id}, Status: ${order.status}`);

    // 2. Atomic Update (Idempotency Check)
    if (order.status !== 'pending') {
        console.log(`[ShopOrderProcess] Order ${order.id} already processed (status: ${order.status}).`);
        return { success: true, alreadyProcessed: true }
    }

    // 2b. Verify the amount Paystack actually charged matches the order's
    // expected total (price + fee), so the order can't be marked paid for less.
    const expectedFee = calculatePaystackFee(order.price, GUEST_PAYSTACK_FEE_PERCENT)
    const expectedAmountKobo = Math.round((order.price + expectedFee) * 100)
    const paidAmountKobo = providerMetadata?.amount

    if (paidAmountKobo !== expectedAmountKobo) {
        console.error(`[ShopOrderProcess] AMOUNT MISMATCH for order ${order.id} (${reference}): expected ${expectedAmountKobo}, got ${paidAmountKobo}`);
        return { success: false, error: 'Amount mismatch' }
    }

    // Merge metadata
    const mergedMetadata = {
        ...(typeof order.payment_metadata === 'object' ? order.payment_metadata : {}),
        provider_data: providerMetadata,
        processed_at: new Date().toISOString()
    };

    const { data: updatedOrder, error: updateOrderError } = await (supabase
        .from('orders') as any)
        .update({
            status: 'pending_download',
            payment_status: 'paid',
            payment_metadata: mergedMetadata,
            updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('status', 'pending')
        .select()
        .single()

    if (updateOrderError || !updatedOrder) {
        console.error('[ShopOrderProcess] Failed to update order status:', updateOrderError);
        return { success: false, error: 'Failed to update order status' }
    }

    // 3. Notify Shop Owner
    if (order.shop_id && order.shops?.user_id) {
        await (supabase.from('notifications') as any).insert({
            user_id: order.shops.user_id,
            title: 'New Shop Sale!',
            message: `You just made a sale of ${order.bundle_size} on ${order.shops.name}. Profit: GHS ${order.profit_amount?.toFixed(2)}`,
            type: 'system',
            action_url: '/dashboard/my-shop',
        })
    }

    return { success: true }
}
