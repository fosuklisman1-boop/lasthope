import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

/**
 * GET endpoint to fetch all users with phone numbers for SMS broadcast
 * Admin only - bypasses RLS
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }
        const supabase = auth.supabase

        // Fetch all users with phone numbers
        const { data: users, error: fetchError } = await supabase
            .from('users')
            .select('id, first_name, last_name, phone_number, role, email')
            .not('phone_number', 'is', null)
            .order('first_name', { ascending: true })

        if (fetchError) {
            console.error('[SMSBroadcast] Error fetching users:', fetchError)
            return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            users: users || []
        })
    } catch (error: any) {
        console.error('[SMSBroadcast] Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
