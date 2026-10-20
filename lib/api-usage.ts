import { createServerClient } from '@/lib/supabase'

// requireApiKey() records which key a request belongs to; the wrapper below reads it
// once the response status is known. A WeakMap keyed by the Request keeps this local to
// one invocation (nothing is stored on the request or leaked into headers).
const keyByRequest = new WeakMap<Request, string>()

export function rememberKey(request: Request, keyId: string): void {
    keyByRequest.set(request, keyId)
}

export interface UsageDelta {
    requests: number
    errors: number
    rateLimited: number
}

/** 429 counts as rate limited, any other 4xx/5xx as an error, everything counts as a request. */
export function classifyStatus(status: number): UsageDelta {
    if (status === 429) return { requests: 1, errors: 0, rateLimited: 1 }
    return { requests: 1, errors: status >= 400 ? 1 : 0, rateLimited: 0 }
}

/** Never throws: counting must not break an API response. */
export async function recordUsage(request: Request, response: Response): Promise<void> {
    const keyId = keyByRequest.get(request)
    if (!keyId) return // request never reached a valid key (bad key, IP throttle)
    try {
        const d = classifyStatus(response.status)
        const { error } = await (createServerClient() as any).rpc('bump_api_key_usage', {
            p_key: keyId,
            p_requests: d.requests,
            p_errors: d.errors,
            p_limited: d.rateLimited,
        })
        if (error) console.error('[api-usage] bump failed:', error.message)
    } catch (e: any) {
        console.error('[api-usage] unexpected failure:', e?.message)
    }
}

/** Wrap a /api/v1 route handler so every authenticated call is counted. */
export function withApiUsage<A extends any[]>(
    handler: (request: Request, ...rest: A) => Promise<Response>
): (request: Request, ...rest: A) => Promise<Response> {
    return async (request, ...rest) => {
        const response = await handler(request, ...rest)
        await recordUsage(request, response)
        return response
    }
}
