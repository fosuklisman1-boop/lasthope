import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const [tablesRes, itemsRes, rolesRes, packagesRes] = await Promise.all([
        db.from('price_tables').select('id, name, description, created_at').order('created_at', { ascending: true }),
        db.from('price_table_items').select('price_table_id'),
        db.from('roles').select('slug, label, price_table_id'),
        db.from('data_packages').select('id', { count: 'exact', head: true }),
    ])
    if (tablesRes.error) return NextResponse.json({ error: tablesRes.error.message }, { status: 500 })

    const itemCount = new Map<string, number>()
    for (const i of itemsRes.data ?? []) itemCount.set(i.price_table_id, (itemCount.get(i.price_table_id) ?? 0) + 1)

    return NextResponse.json({
        packageCount: packagesRes.count ?? 0,
        tables: (tablesRes.data ?? []).map((t: any) => ({
            ...t,
            itemCount: itemCount.get(t.id) ?? 0,
            roles: (rolesRes.data ?? []).filter((r: any) => r.price_table_id === t.id).map((r: any) => ({ slug: r.slug, label: r.label })),
        })),
    })
}

// Create a table, empty or copied from an existing one.
export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : null
    if (name.length < 1 || name.length > 60) return NextResponse.json({ error: 'Give the price table a name of up to 60 characters' }, { status: 400 })
    const copyFrom = body.copyFrom
    if (copyFrom !== undefined && copyFrom !== null && (typeof copyFrom !== 'string' || !UUID_RE.test(copyFrom))) {
        return NextResponse.json({ error: 'Invalid table to copy from' }, { status: 400 })
    }

    const { data: table, error } = await db.from('price_tables').insert({ name, description: description || null }).select().single()
    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: `A price table named "${name}" already exists` }, { status: 409 })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let copied = 0
    if (copyFrom) {
        const { data: source } = await db.from('price_table_items').select('package_id, price').eq('price_table_id', copyFrom)
        if (source && source.length > 0) {
            const { error: copyError } = await db.from('price_table_items').insert(
                source.map((i: any) => ({ price_table_id: table.id, package_id: i.package_id, price: i.price }))
            )
            if (copyError) {
                await db.from('price_tables').delete().eq('id', table.id)
                return NextResponse.json({ error: `Could not copy the prices: ${copyError.message}` }, { status: 500 })
            }
            copied = source.length
        }
    }

    await logAudit(auth, {
        action: 'price_table.create', targetType: 'price_table', targetId: table.id,
        summary: copied ? `Created the price table "${name}" with ${copied} prices copied from another table` : `Created the price table "${name}"`,
        details: { name, copiedFrom: copyFrom ?? null, copied },
    }, request)

    return NextResponse.json({ table: { ...table, itemCount: copied, roles: [] } })
}
