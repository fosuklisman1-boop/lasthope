import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export async function POST(request: Request) {
    try {
        const { userId } = await request.json()

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400 }
            )
        }

        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth

        // Prevent self-deletion
        if (userId === auth.userId) {
            return NextResponse.json(
                { error: 'Cannot delete your own account' },
                { status: 400 }
            )
        }

        // Perform deletion using service role client
        const supabaseAdmin = auth.supabase

        console.log(`[Admin Delete] Attempting to delete user ${userId}`)

        // Step A: Delete from public.users first (Database Layer)
        // Although we have ON DELETE CASCADE, explicit delete ensures we know it worked
        // and handles cases where cascade might fail or be missing
        const { error: dbDeleteError } = await supabaseAdmin
            .from('users')
            .delete()
            .eq('id', userId)

        if (dbDeleteError) {
            console.error('[Admin Delete] Database deletion failed:', dbDeleteError)
            return NextResponse.json(
                { error: `Database deletion failed: ${dbDeleteError.message}` },
                { status: 500 }
            )
        } else {
            console.log('[Admin Delete] Database record deleted (or will be cascaded)')
        }

        // Step B: Delete from Auth (Authentication Layer)
        // This invalidates sessions and removes the auth user
        const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(
            userId
        )

        if (authDeleteError) {
            console.error('[Admin Delete] Auth deletion failed:', authDeleteError)
            // If DB delete worked but Auth failed, we have an inconsistent state
            // But usually, if DB delete worked, Auth delete is less likely to fail unless ID is wrong
            return NextResponse.json(
                { error: `Auth deletion failed: ${authDeleteError.message}` },
                { status: 500 }
            )
        }

        console.log('[Admin Delete] User successfully deleted from Auth and DB')

        return NextResponse.json({ success: true })

    } catch (error: any) {
        console.error('[Admin Delete] Unexpected error:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
