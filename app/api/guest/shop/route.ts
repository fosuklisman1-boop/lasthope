import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const slug = searchParams.get('slug')

        if (!slug) {
            return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
        }

        const supabase = createServerClient()

        // 1. Fetch shop details
        const { data: shop, error: shopError } = await supabase
            .from('shops')
            .select('*')
            .eq('slug', slug)
            .single()

        if (shopError || !shop) {
            return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
        }

        if (!shop.is_active) {
            return NextResponse.json({ error: 'Shop is currently inactive' }, { status: 403 })
        }

        // 2. Fetch packages and join with shop overrides
        const { data: allPackages, error: pkgError } = await supabase
            .from('data_packages')
            .select('*')
            .eq('is_available', true)

        if (pkgError) throw pkgError

        const { data: shopOverrides } = await supabase
            .from('shop_packages')
            .select('*')
            .eq('shop_id', shop.id)

        // 3. Merge and filter enabled packages
        const mergedPackages = allPackages.map(pkg => {
            const override = shopOverrides?.find(o => o.package_id === pkg.id)
            return {
                ...pkg,
                shop_config: override || {
                    is_enabled: true,
                    custom_price: null,
                    profit_margin: 0
                }
            }
        })

        return NextResponse.json({ 
            shop, 
            packages: mergedPackages 
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
