import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function POST(request: Request) {
    try {
        const { userId, status } = await request.json()

        if (!userId || !status) {
            return NextResponse.json(
                { error: 'User ID and status are required' },
                { status: 400 }
            )
        }

        if (!['active', 'suspended', 'inactive'].includes(status)) {
            return NextResponse.json(
                { error: 'Invalid status. Must be active, suspended, or inactive' },
                { status: 400 }
            )
        }

        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth

        // Prevent changing own status
        if (userId === auth.userId) {
            return NextResponse.json(
                { error: 'Cannot change your own account status' },
                { status: 400 }
            )
        }

        // Use service role client for the update (bypasses RLS)
        const supabaseAdmin = auth.supabase

        // Update user status
        const { error: updateError } = await (supabaseAdmin
            .from('users') as any)
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', userId)

        if (updateError) {
            console.error('Error updating user status:', updateError)
            return NextResponse.json(
                { error: `Failed to update user status: ${updateError.message}` },
                { status: 500 }
            )
        }

        console.log(`[Admin] User ${userId} status updated to ${status} by ${auth.userId}`)

        return NextResponse.json({ success: true })

    } catch (error: any) {
        console.error('Update status error:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
