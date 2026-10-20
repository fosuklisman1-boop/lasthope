import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { calculatePaystackFee, generateReferenceCode } from '@/lib/utils'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { getPriceForRole } from '@/lib/pricing'
import { isPaymentMaintenance, MAINTENANCE_MESSAGE } from '@/lib/maintenance'

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!

export async function POST(request: NextRequest) {
    try {
        if (await isPaymentMaintenance()) {
            return NextResponse.json({ error: MAINTENANCE_MESSAGE }, { status: 503 })
        }
        // L4: throttle guest checkout initialization (payment-spam protection)
        const rateLimit = await checkRateLimit(`guest-purchase-init:${getClientIp(request)}`, 10, 60)
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
            )
        }

        const body = await request.json()
        const { packageId, phoneNumber, email, network, shopId } = body

        if (!packageId || !phoneNumber || !email) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Service role client
        const supabase = createServerClient()

        // 1. Get package details
        const { data: pkg, error: pkgError } = await supabase
            .from('data_packages')
            .select('*')
            .eq('id', packageId)
            .eq('is_available', true)
            .single()

        if (pkgError || !pkg) {
            return NextResponse.json({ error: 'Package not found' }, { status: 404 })
        }

        let priceToCharge = Number(pkg.price) || 0
        let profitAmount = 0

        // 2. Handle Shop Pricing if shopId is provided
        console.log('[GuestPurchase] Received shopId:', shopId)
        if (shopId) {
            try {
                // Fetch shop details
                const { data: shop, error: shopErr } = await supabase
                    .from('shops')
                    .select('*')
                    .eq('id', shopId)
                    .single()

                if (shopErr) throw new Error(`Shop fetch error: ${shopErr.message}`)

                if (shop) {
                    console.log('[GuestPurchase] Shop found:', shop.name, 'Owner:', shop.user_id)
                    
                    // Fetch owner role separately to be safe
                    const { data: owner, error: ownerErr } = await supabase
                        .from('users')
                        .select('role')
                        .eq('id', shop.user_id)
                        .single()
                    
                    if (ownerErr) {
                        console.warn('[GuestPurchase] Owner fetch error (ignoring role):', ownerErr.message)
                    }

                    const ownerRole = (owner as any)?.role || 'user'
                    console.log('[GuestPurchase] Owner role identified:', ownerRole)

                    const costPrice = getPriceForRole(pkg as any, ownerRole)
                    
                    console.log('[GuestPurchase] Cost price for owner:', costPrice)

                    // Fetch shop-specific pricing override
                    const { data: shopConfig, error: configErr } = await supabase
                        .from('shop_packages')
                        .select('*')
                        .eq('shop_id', shopId)
                        .eq('package_id', packageId)
                        .single()

                    if (configErr && configErr.code !== 'PGRST116') {
                        console.error('[GuestPurchase] Config fetch error:', configErr.message)
                    }

                    if (shopConfig) {
                        console.log('[GuestPurchase] Shop config found:', shopConfig)
                        if (shopConfig.custom_price && Number(shopConfig.custom_price) > 0) {
                            priceToCharge = Number(shopConfig.custom_price)
                        } else if (shopConfig.profit_margin) {
                            priceToCharge = costPrice + Number(shopConfig.profit_margin)
                        } else {
                            priceToCharge = costPrice
                        }
                    } else {
                        console.log('[GuestPurchase] No shop config found, using cost price.')
                        priceToCharge = costPrice
                    }

                    profitAmount = priceToCharge - costPrice
                    console.log('[GuestPurchase] Calculated priceToCharge:', priceToCharge, 'Profit:', profitAmount)
                }
            } catch (pricingError: any) {
                console.error('[GuestPurchase] Shop pricing error:', pricingError.message)
                // Fallback to default pricing already set in priceToCharge
            }
        } else {
            console.log('[GuestPurchase] No shopId provided, using base price:', priceToCharge)
        }

        const feePercent = 1.95 // Default guest fee
        const fee = calculatePaystackFee(priceToCharge, feePercent)
        const totalAmount = priceToCharge + fee
        const reference = `GST-${generateReferenceCode()}`

        const amountInKobo = Math.round(totalAmount * 100)
        console.log('[GuestPurchase] Amount details:', { priceToCharge, fee, totalAmount, amountInKobo, profitAmount })

        // 3. Create a pending order first
        const { data: order, error: orderError } = await (supabase
            .from('orders') as any)
            .insert({
                user_id: null, // Guest order
                package_id: packageId,
                shop_id: shopId || null,
                profit_amount: profitAmount,
                email: email,
                phone_number: phoneNumber,
                customer_phone: phoneNumber,
                network: pkg.network,
                size: pkg.size,
                price: priceToCharge,
                amount: priceToCharge,
                status: 'pending',
                payment_status: 'unpaid',
                reference_code: reference,
                reference: reference,
                fulfillment_method: 'auto'
            })
            .select()
            .single()

        if (orderError) {
            console.error('[GuestPurchase] Order creation error details:', orderError)
            return NextResponse.json({
                error: 'Failed to create guest order',
                details: orderError.message
            }, { status: 500 })
        }

        console.log('[GuestPurchase] Order created. Initializing Paystack...')

        // 2. Initialize Paystack payment
        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                amount: amountInKobo,
                currency: 'GHS',
                reference: reference,
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/guest/purchase/verify`,
                // Note: unique reference is sufficient for webhook lookup. 
                // Metadata removed to prevent "Authorization code not found" error from Paystack.
            }),
        })

        const paystackData = await paystackResponse.json()
        console.log('[GuestPurchase] Paystack Response:', JSON.stringify(paystackData))

        if (!paystackData.status) {
            console.error('[GuestPurchase] Paystack initialization error:', paystackData)
            return NextResponse.json({
                error: `Payment Gateway Error: ${paystackData.message}`,
                details: paystackData.message
            }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            authorization_url: paystackData.data.authorization_url,
            reference: reference,
        })

    } catch (error: any) {
        console.error('[GuestPurchase] Initialization error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
