import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const supabase = auth.supabase

        const body = await request.json()
        const { network, description } = body

        if (!network) {
            return NextResponse.json({ error: 'Network is required' }, { status: 400 })
        }

        // Update description for all packages of this network
        const { data, error } = await (supabase
            .from('data_packages') as any)
            .update({ description })
            .eq('network', network)
            .select()

        if (error) throw error

        return NextResponse.json({
            success: true,
            updated: data?.length || 0,
            message: `Updated description for ${data?.length || 0} ${network} packages`
        })
    } catch (error: any) {
        console.error('Network Description Update Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
