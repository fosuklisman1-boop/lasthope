import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { logAudit } from '@/lib/audit'

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
        .update({
            ...updates,
            updated_at: new Date().toISOString()
        })
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
