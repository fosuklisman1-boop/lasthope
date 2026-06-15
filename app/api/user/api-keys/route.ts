import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { generateApiKey } from '@/lib/api-keys'
import { newWebhookSecret } from '@/lib/api-webhooks'
import { validateWebhookUrlShape, resolveSafeWebhookTarget } from '@/lib/ssrf-guard'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function getAuthenticatedUserId(): Promise<{ userId: string } | { error: NextResponse }> {
    const cookieStore = await cookies()
    const supabase = createRouteHandlerClient({
        // @ts-expect-error - auth-helpers types expect Promise but runtime needs synchronous object
        cookies: () => cookieStore
    })
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError || !session?.user) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    return { userId: session.user.id }
}

// POST — create a new API key (returns the raw key once)
export async function POST(request: Request) {
    try {
        const auth = await getAuthenticatedUserId()
        if ('error' in auth) return auth.error

        const { userId } = auth
        const body = await request.json().catch(() => ({}))

        const db = createServerClient()

        // Per-account cap: count non-revoked keys
        const { count, error: countError } = await db
            .from('api_keys')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .neq('status', 'revoked')

        if (countError) {
            console.error('[API Keys] Count error:', countError)
            return NextResponse.json({ error: 'Failed to check key limit' }, { status: 500 })
        }

        if ((count ?? 0) >= 5) {
            return NextResponse.json(
                { error: 'Key limit reached', code: 'key_limit' },
                { status: 400 }
            )
        }

        const { key, prefix, hash } = generateApiKey()

        const { error: insertError } = await db
            .from('api_keys')
            .insert({
                user_id: userId,
                key_hash: hash,
                key_prefix: prefix,
                label: body.label || null,
                status: 'pending',
                webhook_secret: newWebhookSecret(),
            })

        if (insertError) {
            console.error('[API Keys] Insert error:', insertError)
            return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
        }

        // Raw key returned ONCE — never stored in plaintext, never returned again
        return NextResponse.json({ key, prefix, status: 'pending' }, { status: 201 })
    } catch (error: any) {
        console.error('[API Keys] POST error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}

// GET — list own keys (never returns key_hash or webhook_secret)
export async function GET() {
    try {
        const auth = await getAuthenticatedUserId()
        if ('error' in auth) return auth.error

        const { userId } = auth
        const db = createServerClient()

        const { data: keys, error } = await db
            .from('api_keys')
            .select('id, key_prefix, label, status, rate_limit_per_min, webhook_url, webhook_events, created_at, last_used_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('[API Keys] GET error:', error)
            return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
        }

        return NextResponse.json({ keys: keys ?? [] })
    } catch (error: any) {
        console.error('[API Keys] GET error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}

// PATCH — update webhook config for own key
export async function PATCH(request: Request) {
    try {
        const auth = await getAuthenticatedUserId()
        if ('error' in auth) return auth.error

        const { userId } = auth
        const body = await request.json().catch(() => ({}))
        const { id, webhook_url, webhook_events, rotate_secret } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing key id' }, { status: 400 })
        }

        const db = createServerClient()

        // Verify this key belongs to the caller before any writes
        const { data: existing, error: fetchError } = await db
            .from('api_keys')
            .select('id')
            .eq('id', id)
            .eq('user_id', userId)
            .single()

        if (fetchError || !existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 })
        }

        // SSRF validation before saving webhook_url
        if (webhook_url !== undefined) {
            const shapeCheck = validateWebhookUrlShape(webhook_url)
            if (!shapeCheck.ok) {
                return NextResponse.json(
                    { error: 'Invalid or unsafe webhook URL', code: 'bad_webhook_url' },
                    { status: 400 }
                )
            }
            const resolveCheck = await resolveSafeWebhookTarget(webhook_url)
            if (!resolveCheck.ok) {
                return NextResponse.json(
                    { error: 'Invalid or unsafe webhook URL', code: 'bad_webhook_url' },
                    { status: 400 }
                )
            }
        }

        // Build patch from provided fields only
        const patch: Record<string, unknown> = {}
        if (webhook_url !== undefined) patch.webhook_url = webhook_url
        if (Array.isArray(webhook_events)) patch.webhook_events = webhook_events

        let newSecret: string | undefined
        if (rotate_secret === true) {
            newSecret = newWebhookSecret()
            patch.webhook_secret = newSecret
        }

        const { error: updateError } = await db
            .from('api_keys')
            .update(patch)
            .eq('id', id)
            .eq('user_id', userId)

        if (updateError) {
            console.error('[API Keys] PATCH error:', updateError)
            return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 })
        }

        // Return the new secret ONCE on rotate; never on other ops
        if (rotate_secret === true && newSecret) {
            return NextResponse.json({ success: true, webhook_secret: newSecret })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[API Keys] PATCH error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}

// DELETE — revoke own key
export async function DELETE(request: Request) {
    try {
        const auth = await getAuthenticatedUserId()
        if ('error' in auth) return auth.error

        const { userId } = auth

        // Support both JSON body and query param
        let id: string | undefined
        try {
            const body = await request.json()
            id = body.id
        } catch {
            const url = new URL(request.url)
            id = url.searchParams.get('id') ?? undefined
        }

        if (!id) {
            return NextResponse.json({ error: 'Missing key id' }, { status: 400 })
        }

        const db = createServerClient()

        const { error } = await db
            .from('api_keys')
            .update({ status: 'revoked' })
            .eq('id', id)
            .eq('user_id', userId)

        if (error) {
            console.error('[API Keys] DELETE error:', error)
            return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[API Keys] DELETE error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
