import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { parseItemUpdates, diffItems, belowCost } from '@/lib/price-tables'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ id: string }> }

async function guard() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return { error: auth }
    if (auth.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    return { auth }
}

// The table and a row for every package, so the grid shows what is and is not priced yet.
export async function GET(_request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid price table' }, { status: 400 })
    const db = g.auth!.supabase as any

    const { data: table } = await db.from('price_tables').select('id, name, description').eq('id', id).maybeSingle()
    if (!table) return NextResponse.json({ error: 'Price table not found' }, { status: 404 })

    const [packagesRes, itemsRes, rolesRes] = await Promise.all([
        db.from('data_packages').select('id, network, size, price, cost_price, is_available, sort_order').order('network').order('sort_order'),
        db.from('price_table_items').select('package_id, price').eq('price_table_id', id),
        db.from('roles').select('slug, label').eq('price_table_id', id),
    ])
    if (packagesRes.error) return NextResponse.json({ error: packagesRes.error.message }, { status: 500 })

    const priced = new Map<string, number>((itemsRes.data ?? []).map((i: any) => [i.package_id, Number(i.price)]))
    return NextResponse.json({
        table,
        roles: rolesRes.data ?? [],
        packages: (packagesRes.data ?? []).map((p: any) => ({
            id: p.id, network: p.network, size: p.size, is_available: p.is_available,
            base: Number(p.price), cost: Number(p.cost_price) || 0,
            price: priced.has(p.id) ? priced.get(p.id)! : null,
        })),
    })
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid price table' }, { status: 400 })
    const auth = g.auth!, db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name.length < 1 || name.length > 60) return NextResponse.json({ error: 'Give the price table a name of up to 60 characters' }, { status: 400 })
        update.name = name
    }
    if (body.description !== undefined) update.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null
    if (Object.keys(update).length === 1) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

    const { data: before } = await db.from('price_tables').select('name, description').eq('id', id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'Price table not found' }, { status: 404 })

    const { data, error } = await db.from('price_tables').update(update).eq('id', id).select().single()
    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'Another price table already has that name' }, { status: 409 })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAudit(auth, {
        action: 'price_table.update', targetType: 'price_table', targetId: id,
        summary: `Edited the price table "${data.name}"`, details: { before, after: { name: data.name, description: data.description } },
    }, request)
    return NextResponse.json({ table: data })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid price table' }, { status: 400 })
    const auth = g.auth!, db = auth.supabase as any

    const reason = (new URL(request.url).searchParams.get('reason') || '').trim()
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

    const { data: table } = await db.from('price_tables').select('id, name').eq('id', id).maybeSingle()
    if (!table) return NextResponse.json({ error: 'Price table not found' }, { status: 404 })

    const { data: using } = await db.from('roles').select('label').eq('price_table_id', id)
    if (using && using.length > 0) {
        return NextResponse.json(
            { error: `This table is used by ${using.map((r: any) => r.label).join(', ')}. Choose another table for ${using.length === 1 ? 'that role' : 'those roles'} first.`, code: 'table_in_use' },
            { status: 409 }
        )
    }

    const { error } = await db.from('price_tables').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'price_table.delete', targetType: 'price_table', targetId: id,
        summary: `Deleted the price table "${table.name}"`, details: { name: table.name }, reason,
    }, request)
    return NextResponse.json({ success: true })
}

// Set or clear many prices at once. null removes a price (the package then costs the base price).
export async function PUT(request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid price table' }, { status: 400 })
    const auth = g.auth!, db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })
    const parsed = parseItemUpdates(body.items)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { data: table } = await db.from('price_tables').select('id, name').eq('id', id).maybeSingle()
    if (!table) return NextResponse.json({ error: 'Price table not found' }, { status: 404 })

    const ids = parsed.items.map(i => i.packageId)
    const [pkgRes, curRes] = await Promise.all([
        db.from('data_packages').select('id, network, size, cost_price').in('id', ids),
        db.from('price_table_items').select('package_id, price').eq('price_table_id', id).in('package_id', ids),
    ])
    const known = new Map<string, any>((pkgRes.data ?? []).map((p: any) => [p.id, p]))
    const missing = ids.filter(i => !known.has(i))
    if (missing.length > 0) return NextResponse.json({ error: `${missing.length} package(s) no longer exist. Reload the page.` }, { status: 400 })

    const current = new Map<string, number>((curRes.data ?? []).map((i: any) => [i.package_id, Number(i.price)]))
    const changes = diffItems(current, parsed.items)
    if (changes.length === 0) return NextResponse.json({ success: true, changed: 0 })

    const now = new Date().toISOString()
    const upserts = changes.filter(c => c.to !== null).map(c => ({ price_table_id: id, package_id: c.packageId, price: c.to, updated_at: now }))
    const removals = changes.filter(c => c.to === null).map(c => c.packageId)

    if (upserts.length) {
        const { error } = await db.from('price_table_items').upsert(upserts, { onConflict: 'price_table_id,package_id' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (removals.length) {
        const { error } = await db.from('price_table_items').delete().eq('price_table_id', id).in('package_id', removals)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await db.from('price_tables').update({ updated_at: now }).eq('id', id)

    const label = (pid: string) => { const p = known.get(pid); return p ? `${p.network} ${p.size}` : pid }
    const belowCostCount = changes.filter(c => belowCost(c.to, known.get(c.packageId)?.cost_price)).length

    await logAudit(auth, {
        action: 'price_table.update', targetType: 'price_table', targetId: id,
        summary: `Changed ${changes.length} price${changes.length === 1 ? '' : 's'} in "${table.name}"${belowCostCount ? ` (${belowCostCount} below cost)` : ''}`,
        details: { changes: changes.slice(0, 50).map(c => ({ package: label(c.packageId), from: c.from, to: c.to })), total: changes.length, belowCost: belowCostCount },
        reason,
    }, request)

    return NextResponse.json({ success: true, changed: changes.length, belowCost: belowCostCount })
}
