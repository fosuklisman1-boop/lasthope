import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { checkAdjustment, parseConfirmAbove } from '@/lib/adjustments'
import { sendWalletTopupSuccessEmail } from '@/lib/email-service'
import { sendWalletTopupSuccessSMS } from '@/lib/sms-service'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const supabase = auth.supabase

        const body = await request.json()
        const { userId, amount, type, confirmLarge } = body

        if (!userId || amount === undefined || !['credit', 'debit'].includes(type)) {
            return NextResponse.json({ error: 'userId, amount, and type (credit or debit) are required' }, { status: 400 })
        }

        // A reason is required, and large amounts need a second confirmation (threshold lives in settings).
        const { data: thresholdRow } = await (supabase.from('admin_settings') as any)
            .select('value')
            .eq('key', 'wallet_adjustment_confirm_above')
            .maybeSingle()
        const check = checkAdjustment({
            amount,
            reason: body.reason ?? body.description,
            confirmLarge: confirmLarge === true,
            confirmAbove: parseConfirmAbove(thresholdRow?.value),
        })
        if (!check.ok) {
            return NextResponse.json(
                { error: check.error, code: check.code },
                { status: check.code === 'needs_confirmation' ? 409 : 400 }
            )
        }
        const adjustmentAmount = check.amount
        const description = check.reason

        // CHECK ENV VAR
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error('[CRITICAL] SUPABASE_SERVICE_ROLE_KEY is MISSING in environment variables!')
        }

        // 1. Get wallet
        let { data: wallet, error: walletFetchError } = await supabase
            .from('wallets')
            .select('id, balance, total_credited, total_spent')
            .eq('user_id', userId)
            .single()

        if (walletFetchError || !wallet) {
            console.log('[AdminWalletAdjustment] Wallet not found, attempting to create one for user:', userId)

            // Check if user exists first
            const { data: userExists } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single()

            if (!userExists) {
                return NextResponse.json({ error: 'User record not found in database. Please ensure user is onboarded.' }, { status: 404 })
            }

            // Create wallet
            const { data: newWallet, error: createError } = await (supabase
                .from('wallets') as any)
                .insert({
                    user_id: userId,
                    balance: 0,
                    total_credited: 0,
                    total_spent: 0
                })
                .select()
                .single()

            if (createError) {
                console.error('[AdminWalletAdjustment] Failed to create wallet:', createError)
                return NextResponse.json({
                    error: 'Failed to create wallet for user',
                    details: createError.message,
                    code: createError.code
                }, { status: 500 })
            }

            wallet = newWallet
        }

        const isCredit = type === 'credit'

        if (!isCredit && (wallet as any).balance < adjustmentAmount) {
            return NextResponse.json({ error: 'User has insufficient balance for this debit' }, { status: 400 })
        }

        // 2. Update wallet (atomic RPC - authoritative balance check, see M1)
        const { data: adjustResult, error: walletUpdateError } = await supabase
            .rpc(isCredit ? 'credit_wallet' : 'debit_wallet', { p_wallet_id: (wallet as any).id, p_amount: adjustmentAmount })
            .single()

        if (walletUpdateError || !adjustResult) {
            console.error('[AdminWalletAdjustment] Wallet update error:', walletUpdateError)
            if (!isCredit && walletUpdateError?.code === 'PGRST116') {
                return NextResponse.json({ error: 'User has insufficient balance for this debit' }, { status: 400 })
            }
            throw walletUpdateError || new Error('Failed to update wallet')
        }

        const newBalance = (adjustResult as any).balance

        // 3. Log transaction
        const { error: transError } = await (supabase.from('wallet_transactions') as any).insert({
            wallet_id: (wallet as any).id,
            user_id: userId,
            type: type,
            amount: adjustmentAmount,
            description: description || 'Admin manual adjustment',
            source: 'admin',
            status: 'completed'
        })

        if (transError) {
            console.error('[AdminWalletAdjustment] Transaction log error:', transError)
        }

        await logAudit(auth, {
            action: 'wallet.adjust',
            targetType: 'user',
            targetId: userId,
            summary: `${isCredit ? 'Credited' : 'Debited'} GHS ${adjustmentAmount.toFixed(2)} ${isCredit ? 'to' : 'from'} a user wallet`,
            details: { type, amount: adjustmentAmount, newBalance },
            reason: description,
        }, request)

        // 4. Send notification
        await (supabase.from('notifications') as any).insert({
            user_id: userId,
            title: isCredit ? 'Wallet Credited' : 'Wallet Debited',
            message: `Your wallet has been ${isCredit ? 'credited' : 'debited'} with GHS ${adjustmentAmount.toFixed(2)}. ${description || ''}`,
            type: 'balance_updated',
            is_read: false
        })

        if (type === 'credit') {
            // 5. Fetch user data for notification
            const { data: user } = await supabase
                .from('users')
                .select('email, first_name, phone_number')
                .eq('id', userId)
                .single()

            if (user) {
                const reference = `MNL-${Date.now()}`

                // Email
                await sendWalletTopupSuccessEmail(
                    (user as any).email,
                    (user as any).first_name || 'Customer',
                    adjustmentAmount,
                    reference,
                    newBalance
                )

                // SMS
                if ((user as any).phone_number) {
                    try {
                        await sendWalletTopupSuccessSMS(
                            (user as any).phone_number,
                            {
                                amount: adjustmentAmount,
                                newBalance
                            }
                        )
                    } catch (smsError) {
                        console.error('[AdminWalletAdjustment] SMS failed:', smsError)
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            newBalance
        })

    } catch (error: any) {
        console.error('Admin Wallet Adjustment Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
