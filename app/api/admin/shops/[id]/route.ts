import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit, type AuditAction } from '@/lib/audit'
import { loadShopBalance, loadShopControls, loadShopLimits, limitsFor } from '@/lib/shop-data'
import { validateShopEdit } from '@/lib/shop-rules'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ id: string }> }

async function guard() {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return { error: auth as NextResponse }
    if (auth.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    return { auth }
}

const reasonOf = (b: any) => (typeof b?.reason === 'string' ? b.reason.trim() : '')

// Tell the owner what happened in their notifications.
async function notifyOwner(db: any, ownerId: string, title: string, message: string) {
    try {
        await db.from('notifications').insert({ user_id: ownerId, title, message, type: 'shop_update', action_url: '/dashboard/my-shop', is_read: false })
    } catch (e: any) {
        console.error('[admin/shops] notification failed:', e?.message)
    }
}

async function upsertControls(db: any, shopId: string, patch: Record<string, unknown>) {
    return db.from('shop_controls').upsert({ shop_id: shopId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' })
}

export async function GET(_request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid shop' }, { status: 400 })
    const db = g.auth!.supabase as any

    const { data: shop } = await db.from('shops').select('*').eq('id', id).maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    try {
        const [controls, platform, balance, ownerRes, ledgerRes, blockedRes, packagesRes, ordersRes, withdrawalsRes] = await Promise.all([
            loadShopControls(db, id),
            loadShopLimits(db),
            loadShopBalance(db, id, shop.user_id),
            db.from('users').select('id, email, first_name, last_name, phone_number, status, role').eq('id', shop.user_id).maybeSingle(),
            db.from('shop_adjustments').select('id, kind, amount, reason, order_id, created_by, created_at').eq('shop_id', id).order('created_at', { ascending: false }).limit(50),
            db.from('shop_blocked_packages').select('package_id, reason, created_at').eq('shop_id', id),
            db.from('data_packages').select('id, network, size').order('network').order('sort_order'),
            db.from('orders').select('id, reference_code, network, size, price, profit_amount, status, payment_status, created_at').eq('shop_id', id).order('created_at', { ascending: false }).limit(20),
            db.from('withdrawals').select('id, amount, status, created_at').eq('user_id', shop.user_id).order('created_at', { ascending: false }).limit(10),
        ])

        const o = ownerRes.data
        return NextResponse.json({
            shop: { id: shop.id, name: shop.name, slug: shop.slug, description: shop.description, logo_url: shop.logo_url, theme_color: shop.theme_color, is_active: shop.is_active, created_at: shop.created_at },
            owner: o ? { id: o.id, email: o.email, name: `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim() || o.email, phone: o.phone_number, status: o.status, role: o.role } : null,
            controls,
            platform,
            effective: limitsFor(controls, platform),
            balance,
            ledger: ledgerRes.data ?? [],
            blocked: blockedRes.data ?? [],
            packages: packagesRes.data ?? [],
            orders: ordersRes.data ?? [],
            withdrawals: withdrawalsRes.data ?? [],
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// One endpoint for every control. Body: { action, reason, ...fields }.
export async function PATCH(request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid shop' }, { status: 400 })
    const auth = g.auth!, db = auth.supabase as any

    const body = await request.json().catch(() => ({}))
    const action = body.action
    const reason = reasonOf(body)

    const { data: shop } = await db.from('shops').select('id, user_id, name, slug, description, logo_url, theme_color').eq('id', id).maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const needReason = () => (reason.length < 5 ? NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 }) : null)
    const audit = (a: AuditAction, summary: string, details: Record<string, unknown>) =>
        logAudit(auth, { action: a, targetType: 'shop', targetId: id, summary, details: { shop: shop.name, ...details }, reason: reason || undefined }, request)
    const fail = (error: any) => NextResponse.json({ error: error.message }, { status: 500 })

    switch (action) {
        case 'suspend': {
            const r = needReason(); if (r) return r
            const message = typeof body.message === 'string' ? body.message.trim().slice(0, 200) : ''
            const hold = body.holdWithdrawals === true
            const { error } = await upsertControls(db, id, {
                suspended: true, suspended_reason: reason, suspended_message: message || null,
                suspended_at: new Date().toISOString(), suspended_by: auth.userId,
                ...(hold ? { withdrawals_held: true, hold_reason: `Shop suspended: ${reason}`.slice(0, 300) } : {}),
            })
            if (error) return fail(error)
            await audit('shop.suspend', `Suspended the shop "${shop.name}"${hold ? ' and held its withdrawals' : ''}`, { message, hold })
            await notifyOwner(db, shop.user_id, 'Your shop has been suspended', message || 'Customers cannot buy from your shop right now. Contact support for details.')
            return NextResponse.json({ success: true })
        }

        case 'unsuspend': {
            const r = needReason(); if (r) return r
            const release = body.releaseHold === true
            const { error } = await upsertControls(db, id, {
                suspended: false, suspended_reason: null, suspended_message: null, suspended_at: null, suspended_by: null,
                ...(release ? { withdrawals_held: false, hold_reason: null } : {}),
            })
            if (error) return fail(error)
            await audit('shop.unsuspend', `Reactivated the shop "${shop.name}"${release ? ' and released its withdrawals' : ''}`, { release })
            await notifyOwner(db, shop.user_id, 'Your shop is active again', 'Customers can buy from your shop again.')
            return NextResponse.json({ success: true })
        }

        case 'hold': {
            const r = needReason(); if (r) return r
            if (typeof body.held !== 'boolean') return NextResponse.json({ error: 'held must be true or false' }, { status: 400 })
            const { error } = await upsertControls(db, id, { withdrawals_held: body.held, hold_reason: body.held ? reason.slice(0, 300) : null })
            if (error) return fail(error)
            await audit('shop.hold', body.held ? `Held withdrawals for "${shop.name}"` : `Released withdrawals for "${shop.name}"`, { held: body.held })
            await notifyOwner(db, shop.user_id, body.held ? 'Your withdrawals are on hold' : 'Your withdrawals are released', body.held ? 'Contact support for details.' : 'You can request withdrawals again.')
            return NextResponse.json({ success: true })
        }

        case 'limits': {
            const r = needReason(); if (r) return r
            const patch: Record<string, unknown> = {}
            if (body.max_margin_percent !== undefined) {
                const v = body.max_margin_percent
                if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000)) return NextResponse.json({ error: 'Maximum margin must be between 0 and 1000 percent' }, { status: 400 })
                patch.max_margin_percent = v === null ? null : Math.round(v * 100) / 100
            }
            if (body.min_withdrawal !== undefined) {
                const v = body.min_withdrawal
                if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1_000_000)) return NextResponse.json({ error: 'Minimum withdrawal must be above 0' }, { status: 400 })
                patch.min_withdrawal = v === null ? null : Math.round(v * 100) / 100
            }
            if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
            const { error } = await upsertControls(db, id, patch)
            if (error) return fail(error)
            await audit('shop.limits', `Changed the limits for "${shop.name}"`, { changes: patch })
            return NextResponse.json({ success: true })
        }

        case 'lock': {
            const r = needReason(); if (r) return r
            if (typeof body.locked !== 'boolean') return NextResponse.json({ error: 'locked must be true or false' }, { status: 400 })
            const { error } = await upsertControls(db, id, { profile_locked: body.locked })
            if (error) return fail(error)
            await audit('shop.moderate', body.locked ? `Locked the profile of "${shop.name}"` : `Unlocked the profile of "${shop.name}"`, { locked: body.locked })
            return NextResponse.json({ success: true })
        }

        case 'edit': {
            const r = needReason(); if (r) return r
            const { action: _a, reason: _r, ...fields } = body
            const parsed = validateShopEdit(fields)
            if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
            if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

            const { error } = await db.from('shops').update({ ...parsed.value, updated_at: new Date().toISOString() }).eq('id', id)
            if (error) {
                if (error.code === '23505') return NextResponse.json({ error: 'Another shop already uses that address' }, { status: 409 })
                return fail(error)
            }
            const before: Record<string, unknown> = {}
            for (const k of Object.keys(parsed.value)) before[k] = (shop as any)[k]
            await audit('shop.moderate', `Edited the profile of "${shop.name}" (${Object.keys(parsed.value).join(', ')})`, { before, after: parsed.value })
            if (parsed.value.slug && parsed.value.slug !== shop.slug) {
                await notifyOwner(db, shop.user_id, 'Your shop address changed', `Your shop is now at /s/${parsed.value.slug}. Update any links you shared.`)
            }
            return NextResponse.json({ success: true })
        }

        case 'block_package':
        case 'unblock_package': {
            const r = needReason(); if (r) return r
            const packageId = typeof body.packageId === 'string' ? body.packageId : ''
            if (!UUID_RE.test(packageId)) return NextResponse.json({ error: 'packageId is required' }, { status: 400 })
            const { data: pkg } = await db.from('data_packages').select('network, size').eq('id', packageId).maybeSingle()
            if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
            const name = `${pkg.network} ${pkg.size}`

            if (action === 'block_package') {
                const { error } = await db.from('shop_blocked_packages').upsert({ shop_id: id, package_id: packageId, reason: reason.slice(0, 300), blocked_by: auth.userId }, { onConflict: 'shop_id,package_id' })
                if (error) return fail(error)
            } else {
                const { error } = await db.from('shop_blocked_packages').delete().eq('shop_id', id).eq('package_id', packageId)
                if (error) return fail(error)
            }
            await audit('shop.package_block', `${action === 'block_package' ? 'Switched off' : 'Switched back on'} ${name} for "${shop.name}"`, { package: name, packageId })
            return NextResponse.json({ success: true })
        }

        case 'notes': {
            const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : ''
            const { error } = await upsertControls(db, id, { notes: notes || null })
            if (error) return fail(error)
            return NextResponse.json({ success: true })
        }

        default:
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
}

// Delete a shop. Only when it never sold anything and has no profit history, so no money is ever lost.
export async function DELETE(request: NextRequest, { params }: Ctx) {
    const g = await guard()
    if (g.error) return g.error
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid shop' }, { status: 400 })
    const auth = g.auth!, db = auth.supabase as any

    const reason = (new URL(request.url).searchParams.get('reason') || '').trim()
    if (reason.length < 5) return NextResponse.json({ error: 'A reason of at least 5 characters is required' }, { status: 400 })

    const { data: shop } = await db.from('shops').select('id, name, slug, user_id').eq('id', id).maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const [orders, ledger] = await Promise.all([
        db.from('orders').select('id', { count: 'exact', head: true }).eq('shop_id', id),
        db.from('shop_adjustments').select('id', { count: 'exact', head: true }).eq('shop_id', id),
    ])
    if ((orders.count ?? 0) > 0 || (ledger.count ?? 0) > 0) {
        return NextResponse.json({ error: 'This shop has sales or profit history, so it cannot be deleted. Suspend it instead.', code: 'has_history' }, { status: 409 })
    }

    const { error } = await db.from('shops').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAudit(auth, { action: 'shop.delete', targetType: 'shop', targetId: id, summary: `Deleted the shop "${shop.name}"`, details: { shop: shop.name, slug: shop.slug, ownerId: shop.user_id }, reason }, request)
    return NextResponse.json({ success: true })
}
