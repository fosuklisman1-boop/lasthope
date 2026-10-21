import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'
import { validateRoleInput, checkPurchasable } from '@/lib/role-rules'

export const dynamic = 'force-dynamic'

// These can never be bought, whatever an admin types: they carry admin power or are the default.
const NEVER_PURCHASABLE = ['admin', 'sub-admin', 'user']
// Changing these changes what people pay or what they can do, so a reason is recorded.
const NEEDS_REASON = ['price_table_id', 'upgrade_price', 'upgradable', 'is_reseller']

function reasonOf(body: any): string {
    return typeof body?.reason === 'string' ? body.reason.trim() : ''
}

export async function GET() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const [rolesRes, tablesRes] = await Promise.all([
        db.from('roles').select('*').order('rank', { ascending: true }),
        db.from('price_tables').select('id, name'),
    ])
    if (rolesRes.error) return NextResponse.json({ error: rolesRes.error.message }, { status: 500 })

    const tableName = new Map<string, string>((tablesRes.data ?? []).map((t: any) => [t.id, t.name]))
    const roles = rolesRes.data ?? []
    const counts = await Promise.all(
        roles.map((r: any) => db.from('users').select('id', { count: 'exact', head: true }).eq('role', r.slug))
    )

    return NextResponse.json({
        roles: roles.map((r: any, i: number) => ({
            ...r,
            upgrade_price: r.upgrade_price === null ? null : Number(r.upgrade_price),
            price_table_name: r.price_table_id ? tableName.get(r.price_table_id) ?? null : null,
            user_count: counts[i].count ?? 0,
        })),
        priceTables: (tablesRes.data ?? []).map((t: any) => ({ id: t.id, name: t.name })),
    })
}

export async function POST(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const parsed = validateRoleInput(body, 'create')
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const v = parsed.value

    const purchasable = checkPurchasable(v.upgradable ?? false, v.upgrade_price ?? null)
    if (purchasable) return NextResponse.json({ error: purchasable }, { status: 400 })

    if (v.price_table_id) {
        const { data: table } = await db.from('price_tables').select('id').eq('id', v.price_table_id).maybeSingle()
        if (!table) return NextResponse.json({ error: 'That price table does not exist' }, { status: 400 })
    }

    const { data, error } = await db.from('roles').insert({
        slug: v.slug, label: v.label, kind: 'custom',
        is_reseller: v.is_reseller ?? false, color: v.color ?? '#0EA5E9', icon: v.icon ?? 'BadgeCheck',
        rank: v.rank ?? 100, price_table_id: v.price_table_id ?? null,
        upgrade_price: v.upgrade_price ?? null, upgradable: v.upgradable ?? false,
    }).select().single()
    if (error) {
        if (error.code === '23505') return NextResponse.json({ error: `A role with the id "${v.slug}" already exists` }, { status: 409 })
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAudit(auth, {
        action: 'role.create', targetType: 'role', targetId: data.slug,
        summary: `Created the role "${data.label}"`,
        details: { role: data }, reason: reasonOf(body) || undefined,
    }, request)

    return NextResponse.json({ role: data })
}

export async function PATCH(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const slug = typeof body.slug === 'string' ? body.slug : ''
    if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })

    const { slug: _ignored, reason: _reason, ...fields } = body
    const parsed = validateRoleInput(fields, 'update')
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const changes = parsed.value
    if (Object.keys(changes).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

    const { data: before } = await db.from('roles').select('*').eq('slug', slug).maybeSingle()
    if (!before) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

    if (before.kind === 'system' && changes.is_reseller !== undefined && changes.is_reseller !== before.is_reseller) {
        return NextResponse.json({ error: 'Whether a built-in role is a reseller cannot be changed' }, { status: 400 })
    }
    if (NEVER_PURCHASABLE.includes(slug) && changes.upgradable === true) {
        return NextResponse.json({ error: 'This role cannot be offered for purchase' }, { status: 400 })
    }

    const nextUpgradable = changes.upgradable ?? before.upgradable
    const nextPrice = changes.upgrade_price !== undefined ? changes.upgrade_price : (before.upgrade_price === null ? null : Number(before.upgrade_price))
    // Removing the price also takes the role off the Upgrade page.
    if (changes.upgrade_price === null && changes.upgradable === undefined) changes.upgradable = false
    const purchasable = checkPurchasable(changes.upgradable ?? nextUpgradable, nextPrice)
    if (purchasable) return NextResponse.json({ error: purchasable }, { status: 400 })

    if (changes.price_table_id) {
        const { data: table } = await db.from('price_tables').select('id').eq('id', changes.price_table_id).maybeSingle()
        if (!table) return NextResponse.json({ error: 'That price table does not exist' }, { status: 400 })
    }

    const reason = reasonOf(body)
    const sensitive = Object.keys(changes).filter(k => NEEDS_REASON.includes(k) && (changes as any)[k] !== before[k])
    if (sensitive.length > 0 && reason.length < 5) {
        return NextResponse.json({ error: 'A reason of at least 5 characters is required for this change' }, { status: 400 })
    }

    const { data, error } = await db.from('roles').update(changes).eq('slug', slug).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const diff: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of Object.keys(changes)) if ((changes as any)[k] !== before[k]) diff[k] = { from: before[k], to: (changes as any)[k] }

    await logAudit(auth, {
        action: 'role.update', targetType: 'role', targetId: slug,
        summary: `Edited the role "${data.label}" (${Object.keys(diff).join(', ') || 'no change'})`,
        details: { changes: diff }, reason: reason || undefined,
    }, request)

    return NextResponse.json({ role: data })
}

export async function DELETE(request: NextRequest) {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const db = auth.supabase as any

    const sp = new URL(request.url).searchParams
    const slug = sp.get('slug') || ''
    const reason = (sp.get('reason') || '').trim()
    if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

    const { data: role } = await db.from('roles').select('slug, label, kind').eq('slug', slug).maybeSingle()
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })
    if (role.kind === 'system') return NextResponse.json({ error: 'Built-in roles cannot be deleted' }, { status: 400 })

    const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('role', slug)
    if ((count ?? 0) > 0) {
        return NextResponse.json(
            { error: `${count} customer${count === 1 ? ' still has' : 's still have'} this role. Move them to another role first.`, code: 'role_in_use', users: count },
            { status: 409 }
        )
    }

    const { error } = await db.from('roles').delete().eq('slug', slug)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, {
        action: 'role.delete', targetType: 'role', targetId: slug,
        summary: `Deleted the role "${role.label}"`, details: { role }, reason,
    }, request)

    return NextResponse.json({ success: true })
}
