import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({ 
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore 
        })
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Get user's shop ID
        const { data: shop } = await supabase
            .from('shops')
            .select('id')
            .eq('user_id', session.user.id)
            .single()

        if (!shop) {
            return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
        }

        // 2. Fetch all available data packages
        const { data: allPackages, error: pkgError } = await supabase
            .from('data_packages')
            .select('*')
            .eq('is_available', true)
            .order('network')
            .order('sort_order')

        if (pkgError) throw pkgError

        // 3. Fetch shop-specific overrides
        const { data: shopOverrides, error: overrideError } = await supabase
            .from('shop_packages')
            .select('*')
            .eq('shop_id', shop.id)

        if (overrideError) throw overrideError

        // 4. Merge results
        const mergedPackages = allPackages.map(pkg => {
            const override = shopOverrides.find(o => o.package_id === pkg.id)
            return {
                ...pkg,
                shop_config: override || {
                    is_enabled: true,
                    custom_price: null,
                    profit_margin: 0
                }
            }
        })

        return NextResponse.json({ packages: mergedPackages, shopId: shop.id })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({ 
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore 
        })
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { shopId, packageId, isEnabled, customPrice, profitMargin } = body

        if (!shopId || !packageId) {
            return NextResponse.json({ error: 'Shop ID and Package ID are required' }, { status: 400 })
        }

        // Verify shop ownership
        const { data: shop } = await supabase
            .from('shops')
            .select('id')
            .eq('id', shopId)
            .eq('user_id', session.user.id)
            .single()

        if (!shop) {
            return NextResponse.json({ error: 'Unauthorized shop access' }, { status: 403 })
        }

        // Upsert override
        const { data, error } = await supabase
            .from('shop_packages')
            .upsert({
                shop_id: shopId,
                package_id: packageId,
                is_enabled: isEnabled,
                custom_price: customPrice,
                profit_margin: profitMargin,
                updated_at: new Date().toISOString()
            }, { onConflict: 'shop_id,package_id' })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json({ success: true, config: data })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
