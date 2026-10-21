import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { resolvePrice } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'

export const dynamic = 'force-dynamic'

// The prices the signed-in customer pays, per package. Only ever the caller's own:
// the customer id comes from the session, never from the request.
export async function GET() {
    const cookieStore = await cookies()
    const supabaseUser = createRouteHandlerClient({
        // @ts-expect-error - auth-helpers types expect Promise but runtime needs synchronous object
        cookies: () => cookieStore,
    })
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServerClient() as any
    try {
        const [ctx, packagesRes] = await Promise.all([
            loadPricingContext(db, user.id),
            db.from('data_packages')
                .select('id, price, agent_price, super_agent_price, premium_agent_price, dealer_price')
                .eq('is_available', true),
        ])
        if (packagesRes.error) throw new Error(packagesRes.error.message)

        const prices: Record<string, number> = {}
        for (const p of packagesRes.data ?? []) prices[p.id] = resolvePrice(p, ctx)

        return NextResponse.json({ role: ctx.role, prices }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (e: any) {
        console.error('[pricing/me] failed:', e?.message)
        return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503 })
    }
}
