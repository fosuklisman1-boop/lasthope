import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { resolvePriceDetail } from '@/lib/pricing'
import { loadPricingContext } from '@/lib/pricing-context'
import { parsePrice, belowCost } from '@/lib/price-tables'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ id: string }> }

// Every package with the price this customer's role pays and the price set just for them.
export async function GET(_request: NextRequest, { params }: Ctx) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
    const db = auth.supabase as any

    const { data: user } = await db.from('users').select('id, role').eq('id', id).maybeSingle()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    let ctx
    try {
        ctx = await loadPricingContext(db, id, user.role)
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
    const { data: packages, error } = await db
        .from('data_packages')
        .select('id, network, size, price, cost_price, agent_price, super_agent_price, premium_agent_price, dealer_price, is_available')
        .order('network').order('sort_order')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: setRows } = await db.from('customer_prices').select('package_id, set_by, reason, updated_at').eq('user_id', id)
    const meta = new Map<string, any>((setRows ?? []).map((r: any) => [r.package_id, r]))

    // What the role alone would charge: the same context without this customer's own prices.
    const roleOnly = { ...ctx, overrides: new Map<string, number>() }

    return NextResponse.json({
        role: user.role,
        packages: (packages ?? []).map((p: any) => {
            const rolePrice = resolvePriceDetail(p, roleOnly).price
            const own = ctx.overrides.get(p.id) ?? null
            return {
                id: p.id, network: p.network, size: p.size, is_available: p.is_available,
                base: Number(p.price), cost: Number(p.cost_price) || 0,
                rolePrice, customPrice: own,
                effective: own ?? rolePrice,
                reason: meta.get(p.id)?.reason ?? null,
                updatedAt: meta.get(p.id)?.updated_at ?? null,
            }
        }),
    })
}

// Set (price) or clear (price: null) one customer price.
export async function PUT(request: NextRequest, { params }: Ctx) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const packageId = typeof body.packageId === 'string' ? body.packageId : ''
    if (!UUID_RE.test(packageId)) return NextResponse.json({ error: 'packageId is required' }, { status: 400 })
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

    const [{ data: user }, { data: pkg }] = await Promise.all([
        db.from('users').select('id, email').eq('id', id).maybeSingle(),
        db.from('data_packages').select('id, network, size, cost_price').eq('id', packageId).maybeSingle(),
    ])
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

    const { data: existing } = await db.from('customer_prices').select('price').eq('user_id', id).eq('package_id', packageId).maybeSingle()
    const from = existing ? Number(existing.price) : null
    const pkgName = `${pkg.network} ${pkg.size}`

    if (body.price === null) {
        if (from === null) return NextResponse.json({ success: true, changed: false })
        const { error } = await db.from('customer_prices').delete().eq('user_id', id).eq('package_id', packageId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await logAudit(auth, {
            action: 'customer_price.clear', targetType: 'user', targetId: id,
            summary: `Removed a custom price for ${pkgName}`,
            details: { package: pkgName, packageId, from, email: user.email, userId: id }, reason,
        }, request)
        return NextResponse.json({ success: true, changed: true })
    }

    const parsed = parsePrice(body.price)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (from === parsed.price) return NextResponse.json({ success: true, changed: false })

    const { error } = await db.from('customer_prices').upsert({
        user_id: id, package_id: packageId, price: parsed.price, set_by: auth.userId, reason, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,package_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const loss = belowCost(parsed.price, pkg.cost_price)
    await logAudit(auth, {
        action: 'customer_price.set', targetType: 'user', targetId: id,
        summary: `Set a custom price of GHS ${parsed.price.toFixed(2)} for ${pkgName}${loss ? ' (below cost)' : ''}`,
        details: { package: pkgName, packageId, from, to: parsed.price, belowCost: loss, email: user.email, userId: id }, reason,
    }, request)

    return NextResponse.json({ success: true, changed: true, belowCost: loss })
}
