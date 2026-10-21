import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { loadShopControls, loadShopLimits, limitsFor } from '@/lib/shop-data'

// Slug generation utility
const generateSlug = (name: string): string => {
    const sanitized = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    
    const randomSuffix = Math.random().toString(36).substring(2, 7)
    return `${sanitized}-${randomSuffix}`
}

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

        const { data: shop, error } = await supabase
            .from('shops')
            .select('*')
            .eq('user_id', user.id)
            .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // What the admin has restricted on this shop, so the dashboard can explain it
        let controls = null
        if (shop) {
            try {
                const svc = createServerClient() as any
                const [c, l] = await Promise.all([loadShopControls(svc, shop.id), loadShopLimits(svc)])
                const eff = limitsFor(c, l)
                controls = {
                    suspended: c.suspended, message: c.suspended_message, withdrawals_held: c.withdrawals_held, hold_reason: c.hold_reason,
                    profile_locked: c.profile_locked, max_margin_percent: eff.maxMarginPercent, min_withdrawal: eff.minWithdrawal,
                }
            } catch (e: any) {
                console.error('[user/shop] controls failed:', e?.message)
            }
        }

        return NextResponse.json({ shop, controls })
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
        const { name, description, logoUrl, themeColor } = body

        if (!name) {
            return NextResponse.json({ error: 'Shop name is required' }, { status: 400 })
        }

        // Check if user already has a shop
        const { data: existingShop } = await supabase
            .from('shops')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (existingShop) {
            return NextResponse.json({ error: 'You already have a shop' }, { status: 400 })
        }

        const slug = generateSlug(name)

        const { data: shop, error } = await (createServerClient() as any)
            .from('shops')
            .insert({
                user_id: user.id,
                name,
                slug,
                description,
                logo_url: logoUrl,
                theme_color: themeColor || '#0f172a'
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ shop })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
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
        const { id, name, description, logoUrl, themeColor, isActive } = body

        if (!id) {
            return NextResponse.json({ error: 'Shop ID is required' }, { status: 400 })
        }

        const svc = createServerClient() as any
        const { data: current } = await svc.from('shops').select('id, name, description, logo_url').eq('id', id).eq('user_id', user.id).maybeSingle()
        if (!current) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

        // An admin can lock the public profile (for example after a complaint).
        try {
            const controls = await loadShopControls(svc, id)
            if (controls.profile_locked) {
                const changed =
                    (name !== undefined && name !== current.name) ||
                    (description !== undefined && (description || null) !== (current.description || null)) ||
                    (logoUrl !== undefined && (logoUrl || null) !== (current.logo_url || null))
                if (changed) return NextResponse.json({ error: 'An admin has locked your shop profile. Contact support to change it.' }, { status: 403 })
            }
        } catch (e: any) {
            return NextResponse.json({ error: 'Could not check your shop settings. Please try again.' }, { status: 503 })
        }

        const { data: shop, error } = await svc
            .from('shops')
            .update({
                name,
                description,
                logo_url: logoUrl,
                theme_color: themeColor,
                is_active: isActive,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ shop })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
