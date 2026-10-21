import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { resolvePrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { parsePrice, MAX_ITEMS_PER_UPDATE } from '@/lib/price-tables'

export async function GET(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({ 
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore 
        })
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Get user's shop ID
        const { data: shop } = await supabase
            .from('shops')
            .select('id')
            .eq('user_id', user.id)
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
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
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
            .eq('user_id', user.id)
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

// Set many shop prices at once (the per-GB tool). The reseller's own cost comes from the server,
// never from the browser: their role's price table and any price an admin set just for them.
// Body: { shopId, items: [{ packageId, customPrice }] }
export async function PUT(request: NextRequest) {
    try {
        const cookieStore = await cookies()
        const supabase = createRouteHandlerClient({
            // @ts-expect-error - Next.js 15 cookie types
            cookies: () => cookieStore
        })
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await request.json().catch(() => ({}))
        const shopId = typeof body.shopId === 'string' ? body.shopId : ''
        if (!shopId) return NextResponse.json({ error: 'Shop ID is required' }, { status: 400 })
        if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS_PER_UPDATE) {
            return NextResponse.json({ error: `items must hold between 1 and ${MAX_ITEMS_PER_UPDATE} packages` }, { status: 400 })
        }

        const items: { packageId: string; price: number }[] = []
        const seen = new Set<string>()
        for (const raw of body.items) {
            const packageId = typeof raw?.packageId === 'string' ? raw.packageId : ''
            if (!packageId || seen.has(packageId)) return NextResponse.json({ error: 'Each item needs a distinct package' }, { status: 400 })
            seen.add(packageId)
            const p = parsePrice(raw.customPrice)
            if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 })
            items.push({ packageId, price: p.price })
        }

        // The shop must belong to the caller
        const { data: shop } = await supabase.from('shops').select('id').eq('id', shopId).eq('user_id', user.id).single()
        if (!shop) return NextResponse.json({ error: 'Unauthorized shop access' }, { status: 403 })

        const ids = items.map(i => i.packageId)
        const svc = createServerClient() as any
        let ctx
        try {
            ctx = await loadPricingContext(svc, user.id)
        } catch (e: any) {
            console.error('[shop bulk prices] pricing failed:', e?.message)
            return NextResponse.json({ error: 'Prices are temporarily unavailable' }, { status: 503 })
        }

        const [{ data: pkgs }, { data: existing }] = await Promise.all([
            svc.from('data_packages').select('*').in('id', ids).eq('is_available', true),
            supabase.from('shop_packages').select('package_id, is_enabled').eq('shop_id', shopId).in('package_id', ids),
        ])
        const byId = new Map<string, any>((pkgs ?? []).map((p: any) => [p.id, p]))
        if (items.some(i => !byId.has(i.packageId))) return NextResponse.json({ error: 'Some packages are no longer available. Reload the page.' }, { status: 400 })
        const enabled = new Map<string, boolean>((existing ?? []).map((r: any) => [r.package_id, r.is_enabled]))

        const now = new Date().toISOString()
        const rows = items.map(i => {
            const cost = resolvePrice(byId.get(i.packageId), ctx)
            return {
                shop_id: shopId, package_id: i.packageId,
                is_enabled: enabled.has(i.packageId) ? enabled.get(i.packageId) : true,
                custom_price: i.price, profit_margin: Math.round((i.price - cost) * 100) / 100, updated_at: now,
            }
        })

        const { error } = await supabase.from('shop_packages').upsert(rows, { onConflict: 'shop_id,package_id' })
        if (error) throw error

        const belowCost = rows.filter(r => r.profit_margin < 0).length
        return NextResponse.json({ success: true, changed: rows.length, belowCost, rows: rows.map(r => ({ package_id: r.package_id, custom_price: r.custom_price, profit_margin: r.profit_margin })) })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
