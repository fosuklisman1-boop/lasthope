import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const supabase = auth.supabase

        // Add timeout to prevent hanging queries
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Database query timeout')), 10000)
        )

        const fetchPromise = supabase
            .from('users')
            .select(`
                id,
                email,
                first_name,
                last_name,
                phone_number,
                role,
                status,
                created_at,
                updated_at
            `)
            .eq('role', 'agent')
            .order('created_at', { ascending: false })

        const { data: agents, error: fetchError } = await Promise.race([
            fetchPromise,
            timeoutPromise
        ]) as any

        if (fetchError) {
            console.error('[AdminAgentsFetch] Database error:', fetchError)
            throw new Error(`Database query failed: ${fetchError.message}`)
        }

        console.log('[AdminAgentsFetch] Successfully fetched', agents?.length || 0, 'agents')

        return NextResponse.json(agents || [])
    } catch (error: any) {
        console.error('Admin Agents Fetch Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
