import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Helper to add cache-prevention headers
function addNoCacheHeaders(response: NextResponse) {
    response.headers.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
}

export async function middleware(request: NextRequest) {
    const res = NextResponse.next()
    const supabase = createMiddlewareClient({ req: request, res })

    const pathname = request.nextUrl.pathname

    let user = null

    try {
        // Add 10 second timeout to prevent hanging (increased for slow connections)
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('User timeout')), 10000)
        )

        const userPromise = supabase.auth.getUser()

        const { data } = await Promise.race([
            userPromise,
            timeout
        ]) as any

        user = data?.user || null
    } catch (error) {
        console.error('Middleware user error:', error)
        // On error or timeout, treat as unauthenticated
        user = null
    }

    // Protected dashboard routes
    if (pathname.startsWith('/dashboard')) {
        if (!user) {
            return addNoCacheHeaders(NextResponse.redirect(new URL('/auth/login', request.url)))
        }
    }

    // Protected admin routes
    if (pathname.startsWith('/admin')) {
        if (!user) {
            return addNoCacheHeaders(NextResponse.redirect(new URL('/auth/login', request.url)))
        }

        try {
            // Add 5 second timeout to role check (reduced to prevent long hanging)
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Role check timeout')), 5000)
            )

            // Supabase middleware client handles auth token refresh automatically
            // We just need to check the role.
            const roleQuery = supabase
                .from('users')
                .select('role')
                .eq('id', user.id)
                .single()

            const { data: userRole, error } = await Promise.race([
                roleQuery,
                timeout
            ]) as any

            if (error || !userRole || (userRole.role !== 'admin' && userRole.role !== 'sub-admin')) {
                // If error, timeout, or invalid role, redirect.
                // Log only if it's an error to avoid noise on simple redirection
                if (error) console.error('Middleware role check failed:', error)
                return addNoCacheHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
            }
        } catch (error) {
            console.error('Middleware role check error:', error)
            // On error or timeout, redirect to dashboard (deny admin access)
            return addNoCacheHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
        }
    }

    // Redirect authenticated users away from auth pages
    if (pathname.startsWith('/auth')) {
        if (user) {
            return addNoCacheHeaders(NextResponse.redirect(new URL('/dashboard', request.url)))
        }
    }

    return addNoCacheHeaders(res)
}

export const config = {
    matcher: ['/dashboard/:path*', '/admin/:path*', '/auth/:path*'],
}
