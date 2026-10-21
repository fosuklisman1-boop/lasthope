import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { resolvePrice, shopPrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { loadShopControls, loadShopLimits, loadBlockedPackageIds, limitsFor, DEFAULT_SUSPENSION_MESSAGE } from '@/lib/shop-data'

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

        // Admin controls: suspension, blocked packages and the margin cap
        let controls, limits, blocked
        try {
            ;[controls, limits, blocked] = await Promise.all([
                loadShopControls(supabase, shop.id), loadShopLimits(supabase), loadBlockedPackageIds(supabase, shop.id),
            ])
        } catch (e: any) {
            console.error('[guest/shop] controls failed:', e?.message)
            return NextResponse.json({ error: 'This shop is temporarily unavailable' }, { status: 503 })
        }
        if (controls.suspended) {
            return NextResponse.json({ error: controls.suspended_message || DEFAULT_SUSPENSION_MESSAGE, suspended: true }, { status: 403 })
        }
        const maxMargin = limitsFor(controls, limits).maxMarginPercent

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

        // 3. Merge, and price each package the way checkout will: the owner's cost (their role's
        //    price table or their own custom price) plus the shop's margin or custom price.
        let ownerCtx
        try {
            ownerCtx = await loadPricingContext(supabase, shop.user_id)
        } catch (e: any) {
            console.error('[guest/shop] owner pricing failed:', e?.message)
            return NextResponse.json({ error: 'Prices are temporarily unavailable' }, { status: 503 })
        }
        const mergedPackages = allPackages.filter(pkg => !blocked.has(pkg.id)).map(pkg => {
            const override = shopOverrides?.find(o => o.package_id === pkg.id)
            // Only what the storefront needs: no cost price, no reseller tier prices.
            return {
                id: pkg.id, network: pkg.network, size: pkg.size, description: pkg.description, price: pkg.price,
                shop_price: shopPrice(resolvePrice(pkg as any, ownerCtx), override, maxMargin),
                shop_config: override || {
                    is_enabled: true,
                    custom_price: null,
                    profit_margin: 0
                }
            }
        })

        // The owner's internal id and the shop's admin state are not part of the public page.
        const publicShop = { id: shop.id, name: shop.name, slug: shop.slug, description: shop.description, logo_url: shop.logo_url, theme_color: shop.theme_color }
        return NextResponse.json({ shop: publicShop, packages: mergedPackages })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
