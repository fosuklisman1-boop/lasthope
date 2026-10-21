import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { parsePrice, MAX_ITEMS_PER_UPDATE } from '@/lib/price-tables'

export async function GET(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await auth.supabase
        .from('data_packages')
        .select('*')
        .order('network')
        .order('sort_order')

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    // Explicitly cast insert to avoid type errors with string enums if mismatch
    const { data, error } = await (auth.supabase
        .from('data_packages') as any)
        .insert(body)
        .select()
        .single()

    if (error) {
        console.error('Create package error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAudit(auth, {
        action: 'package.create',
        targetType: 'package',
        targetId: String(data?.id ?? ''),
        summary: `Created a data package${data?.network ? ' on ' + data.network : ''}`,
        details: { package: data },
    }, request)

    return NextResponse.json(data)
}

export async function PUT(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
        return NextResponse.json({ error: 'Package ID required' }, { status: 400 })
    }

    const { data, error } = await (auth.supabase
        .from('data_packages') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) {
        console.error('Update package error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAudit(auth, {
        action: 'package.update',
        targetType: 'package',
        targetId: String(id),
        summary: `Edited a data package${data?.network ? ' on ' + data.network : ''}`,
        details: { changes: updates },
    }, request)

    return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
        return NextResponse.json({ error: 'Package ID required' }, { status: 400 })
    }

    const { data: gone } = await (auth.supabase.from('data_packages') as any).select('*').eq('id', id).single()

    const { error } = await auth.supabase
        .from('data_packages')
        .delete()
        .eq('id', id)

    if (error) {
        console.error('Delete package error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAudit(auth, {
        action: 'package.delete',
        targetType: 'package',
        targetId: id,
        summary: `Deleted a data package${gone?.network ? ' on ' + gone.network : ''}`,
        details: { package: gone },
    }, request)

    return NextResponse.json({ success: true })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Set the selling price or the cost price of many packages at once (the per-GB tool).
// Body: { field: 'price' | 'cost_price', items: [{ id, value }], reason }
export async function PATCH(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const field = body.field
    if (field !== 'price' && field !== 'cost_price') return NextResponse.json({ error: 'field must be price or cost_price' }, { status: 400 })
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS_PER_UPDATE) {
        return NextResponse.json({ error: `items must hold between 1 and ${MAX_ITEMS_PER_UPDATE} packages` }, { status: 400 })
    }

    const items: { id: string; value: number }[] = []
    const seen = new Set<string>()
    for (const raw of body.items) {
        const id = typeof raw?.id === 'string' ? raw.id : ''
        if (!UUID_RE.test(id) || seen.has(id)) return NextResponse.json({ error: 'Each item needs a distinct valid package id' }, { status: 400 })
        seen.add(id)
        const p = parsePrice(raw.value)
        if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 })
        items.push({ id, value: p.price })
    }

    const { data: current, error: readError } = await db.from('data_packages').select('id, network, size, price, cost_price').in('id', items.map(i => i.id))
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
    const byId = new Map<string, any>((current ?? []).map((p: any) => [p.id, p]))
    if (items.some(i => !byId.has(i.id))) return NextResponse.json({ error: 'Some packages no longer exist. Reload the page.' }, { status: 400 })

    const changes = items.filter(i => Number(byId.get(i.id)[field]) !== i.value)
    if (changes.length === 0) return NextResponse.json({ success: true, changed: 0 })

    const results = await Promise.all(changes.map(c => db.from('data_packages').update({ [field]: c.value }).eq('id', c.id)))
    const failed = results.find((r: any) => r.error)
    if (failed) return NextResponse.json({ error: failed.error.message }, { status: 500 })

    // After the change, would any package sell for less than it costs?
    let belowCostCount = 0
    for (const c of changes) {
        const p = byId.get(c.id)
        const price = field === 'price' ? c.value : Number(p.price)
        const cost = field === 'cost_price' ? c.value : Number(p.cost_price) || 0
        if (cost > 0 && price < cost) belowCostCount++
    }

    await logAudit(auth, {
        action: 'package.update',
        targetType: 'package',
        targetId: 'bulk',
        summary: `Changed the ${field === 'price' ? 'selling price' : 'cost price'} of ${changes.length} package${changes.length === 1 ? '' : 's'}${belowCostCount ? ` (${belowCostCount} below cost)` : ''}`,
        details: {
            field,
            changes: changes.slice(0, 50).map(c => ({ package: `${byId.get(c.id).network} ${byId.get(c.id).size}`, from: Number(byId.get(c.id)[field]), to: c.value })),
            total: changes.length,
            belowCost: belowCostCount,
        },
        reason,
    }, request)

    return NextResponse.json({ success: true, changed: changes.length, belowCost: belowCostCount })
}
