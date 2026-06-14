import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createServerClient } from '@/lib/supabase'
import { cookies } from 'next/headers'
import type { Session } from '@supabase/supabase-js'

export type AdminAuth = {
    session: Session
    role: 'admin' | 'sub-admin'
    supabase: ReturnType<typeof createServerClient>
}

// Shared auth+role handshake for app/api/admin/* routes (middleware does not
// protect /api/*, so every admin route must call this first).
// Returns the session + service-role client on success, or a 401/403
// NextResponse to return immediately.
export async function requireAdmin(): Promise<AdminAuth | NextResponse> {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({
        // @ts-expect-error - Next.js 15 cookie types
        cookies: () => cookieStore
    })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseService = createServerClient()
    const { data: user } = await supabaseService
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single()

    const role = user?.role
    if (!role || !['admin', 'sub-admin'].includes(role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return { session, role: role as 'admin' | 'sub-admin', supabase: supabaseService }
}
