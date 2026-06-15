# Developer API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned `/api/v1` developer API (admin-approved API keys) so account holders can list packages at their tier price, place wallet-billed data orders, check order status, and check wallet balance — with durable signed order-status webhooks — reusing the existing pricing/wallet/rate-limit infrastructure and hardened per the security spec.

**Architecture:** API-key auth helper (`requireApiKey`, mirrors `requireAdmin`) → a shared `placeOrder()` service extracted from the cookie buy route (debit-first) → four `/api/v1` route handlers → a `setOrderStatus()` chokepoint that enqueues `api_webhook_deliveries` rows delivered by a cron with SSRF-safe, signed, retried POSTs. All money math is server-side; every query is scoped to the key's `user_id`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (service-role client + SECURITY DEFINER RPCs), Node `crypto`, Vitest (single-fork pool already configured).

**Spec:** `docs/superpowers/specs/2026-06-15-developer-api-design.md` (read §9 Security — it is normative).

**Conventions (verified in this codebase):**
- Migrations applied to Supabase project `jiuftcsomwnbnjikrbdp` via the Management API: POST `{query}` to `https://api.supabase.com/v1/projects/jiuftcsomwnbnjikrbdp/database/query` with `Authorization: Bearer <token>` where the token is at `mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN` in `../.mcp.json`. Use a temp `_apply.mjs` and delete it after. Type regen via `https://api.supabase.com/v1/projects/jiuftcsomwnbnjikrbdp/types/typescript`.
- Service-role client: `createServerClient()` from `lib/supabase.ts` (bypasses RLS — scope every query manually).
- Admin auth: `requireAdmin()` from `lib/require-admin.ts` returns `{session, role, supabase}` or a `NextResponse`.
- Rate limit: `checkRateLimit(key, max, windowSec)` from `lib/rate-limit.ts` → `{allowed, remaining, retryAfterSeconds}` (fails open).
- Tests run with `npm test` (vitest single-fork). Type check: `npx tsc --noEmit`. Dev app on port 3000/3001 for curl checks.
- Commit after each task.

---

## PHASE 1 — Foundations (schema, secrets, key crypto, trusted IP)

### Task 1: Migration — api_keys, api_webhook_deliveries, per-user idempotency index

**Files:**
- Create: `migrations/20260615_developer_api.sql`
- Modify: `types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration `migrations/20260615_developer_api.sql`**

```sql
-- Developer API: api keys, webhook deliveries, per-user idempotency

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  rate_limit_per_min integer NOT NULL DEFAULT 60,
  webhook_url text,
  webhook_secret text,
  webhook_events text[] NOT NULL DEFAULT ARRAY['order.completed','order.failed','order.refunded'],
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys (user_id);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- intentionally NO policy: only the service-role client may read/write.

CREATE TABLE IF NOT EXISTS public.api_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  event text NOT NULL,
  order_id uuid,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_response_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON public.api_webhook_deliveries (status, next_attempt_at);
ALTER TABLE public.api_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key
  ON public.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

- [ ] **Step 2: Apply via Management API** — write a temp `_apply.mjs` (then delete it):

```js
import fs from 'fs'
const TOKEN = JSON.parse(fs.readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN
const sql = fs.readFileSync('migrations/20260615_developer_api.sql','utf8')
const res = await fetch('https://api.supabase.com/v1/projects/jiuftcsomwnbnjikrbdp/database/query', {
  method:'POST', headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'}, body:JSON.stringify({query:sql})})
console.log('HTTP', res.status); console.log(await res.text())
```
Run `node _apply.mjs`. Expected HTTP 201. If error body, STOP and report.

- [ ] **Step 3: Verify** — POST this query the same way:
```sql
select
 (select count(*) from information_schema.tables where table_name in ('api_keys','api_webhook_deliveries')) as new_tables,
 (select count(*) from pg_indexes where indexname='orders_user_idempotency_key') as idem_index;
```
Expected: `new_tables = 2`, `idem_index = 1`.

- [ ] **Step 4: Regenerate types** into `types/database.types.ts` (fetch the typescript endpoint, write `j.types`). Confirm `api_keys` and `api_webhook_deliveries` appear.

- [ ] **Step 5: Delete temp `.mjs`; `npx tsc --noEmit` (exit 0); commit**
```bash
git add migrations/20260615_developer_api.sql types/database.types.ts
git commit -m "feat(api): migration for api_keys, webhook deliveries, per-user idempotency"
```

---

### Task 2: API-key crypto + strict header parsing (`lib/api-keys.ts`) — TDD

**Files:**
- Create: `lib/api-keys.ts`, `lib/api-keys.test.ts`
- Modify: `.env`, `.env.example` (add `API_KEY_PEPPER`)

- [ ] **Step 1: Add the pepper env var.** Append to `.env.example`:
```
# Developer API
API_KEY_PEPPER=replace_with_a_long_random_secret
```
And set a real value in `.env` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

- [ ] **Step 2: Write the failing test `lib/api-keys.test.ts`**
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { generateApiKey, hashApiKey, parseBearerKey } from './api-keys'

beforeAll(() => { process.env.API_KEY_PEPPER = 'test-pepper' })

describe('api-keys', () => {
  it('generates lh_live_ keys with a stored prefix and matching hash', () => {
    const { key, prefix, hash } = generateApiKey()
    expect(key).toMatch(/^lh_live_[A-Za-z0-9_-]{43}$/)   // 32 bytes base64url = 43 chars
    expect(prefix.length).toBeLessThanOrEqual(12)
    expect(key.startsWith(prefix)).toBe(true)
    expect(hash).toBe(hashApiKey(key))
  })
  it('hash is deterministic HMAC keyed by the pepper', () => {
    const h1 = hashApiKey('lh_live_abc'); const h2 = hashApiKey('lh_live_abc')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    process.env.API_KEY_PEPPER = 'other'
    expect(hashApiKey('lh_live_abc')).not.toBe(h1)
    process.env.API_KEY_PEPPER = 'test-pepper'
  })
  it('parses a valid Bearer key and rejects malformed/empty/dup headers', () => {
    expect(parseBearerKey('Bearer lh_live_' + 'a'.repeat(43))).toBe('lh_live_' + 'a'.repeat(43))
    expect(parseBearerKey(null)).toBeNull()
    expect(parseBearerKey('Bearer ')).toBeNull()
    expect(parseBearerKey('Bearer xyz')).toBeNull()           // wrong prefix/too short
    expect(parseBearerKey('lh_live_' + 'a'.repeat(43))).toBeNull() // missing scheme
    expect(parseBearerKey('Bearer a, Bearer b')).toBeNull()   // duplicate joined header
  })
})
```

- [ ] **Step 3: Run `npx vitest run lib/api-keys.test.ts` — expect FAIL (module missing).**

- [ ] **Step 4: Implement `lib/api-keys.ts`**
```ts
import crypto from 'crypto'

const KEY_RE = /^lh_live_[A-Za-z0-9_-]{43}$/

function pepper(): string {
  const p = process.env.API_KEY_PEPPER
  if (!p) throw new Error('API_KEY_PEPPER is not set')
  return p
}

export function hashApiKey(key: string): string {
  return crypto.createHmac('sha256', pepper()).update(key).digest('hex')
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(32).toString('base64url') // 43 chars
  const key = `lh_live_${random}`
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

// Strict: exactly "Bearer <key>", single header, key matches KEY_RE. Returns the key or null.
export function parseBearerKey(authHeader: string | null | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null
  if (authHeader.includes(',')) return null            // duplicate/joined headers
  const m = authHeader.match(/^Bearer (\S+)$/)
  if (!m) return null
  const key = m[1]
  return KEY_RE.test(key) ? key : null
}
```

- [ ] **Step 5: Run `npx vitest run lib/api-keys.test.ts` — expect PASS. Then `npx tsc --noEmit` (exit 0).**

- [ ] **Step 6: Commit**
```bash
git add lib/api-keys.ts lib/api-keys.test.ts .env.example
git commit -m "feat(api): api-key generation, HMAC hashing, strict bearer parsing"
```

---

### Task 3: Trusted client IP (`lib/rate-limit.ts`) — TDD

**Files:**
- Modify: `lib/rate-limit.ts`
- Create: `lib/rate-limit.test.ts`

Context: the existing `getClientIp` reads the spoofable leftmost `x-forwarded-for`. Add `getTrustedClientIp(request)` that prefers Vercel's platform header. Do NOT remove `getClientIp` (other routes use it).

- [ ] **Step 1: Write failing test `lib/rate-limit.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import { getTrustedClientIp } from './rate-limit'

function req(headers: Record<string,string>) {
  return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Request
}

describe('getTrustedClientIp', () => {
  it('prefers x-vercel-forwarded-for over client x-forwarded-for', () => {
    expect(getTrustedClientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9')
  })
  it('falls back to x-real-ip, then unknown', () => {
    expect(getTrustedClientIp(req({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
    expect(getTrustedClientIp(req({}))).toBe('unknown')
  })
  it('ignores spoofed leftmost x-forwarded-for when a trusted header exists', () => {
    expect(getTrustedClientIp(req({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-forwarded-for': 'evil' }))).toBe('9.9.9.9')
  })
})
```

- [ ] **Step 2: Run `npx vitest run lib/rate-limit.test.ts` — expect FAIL.**

- [ ] **Step 3: Add to `lib/rate-limit.ts`** (keep existing exports):
```ts
// Trusted client IP for security-sensitive limits. On Vercel, x-vercel-forwarded-for
// and x-real-ip are set by the platform proxy and cannot be spoofed by the client,
// unlike the inbound x-forwarded-for (whose leftmost entry is attacker-controlled).
export function getTrustedClientIp(request: Request): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')
  if (vercel) return vercel.split(',')[0].trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
```

- [ ] **Step 4: Run the test — expect PASS. `npx tsc --noEmit` exit 0.**

- [ ] **Step 5: Commit**
```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts
git commit -m "feat(api): trusted client IP helper for pre-auth throttling"
```

---

## PHASE 2 — API-key authentication

### Task 4: `requireApiKey()` auth helper (`lib/require-api-key.ts`)

**Files:**
- Create: `lib/require-api-key.ts`

Mostly DB-bound (integration-tested via the endpoints in later tasks). Provide full code; verify via `tsc` here and via curl once an endpoint exists (Task 6).

- [ ] **Step 1: Implement `lib/require-api-key.ts`**
```ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkRateLimit, getTrustedClientIp } from '@/lib/rate-limit'
import { parseBearerKey, hashApiKey } from '@/lib/api-keys'
import type { UserRole } from '@/lib/roles'

export interface ApiKeyAuth {
  keyId: string
  user: { id: string; role: UserRole }
  wallet: { id: string; balance: number }
  supabase: ReturnType<typeof createServerClient>
}

function err(error: string, code: string, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json({ error, code }, { status, headers: extraHeaders })
}

export async function requireApiKey(request: Request): Promise<ApiKeyAuth | NextResponse> {
  const ip = getTrustedClientIp(request)

  // 1. Pre-auth IP throttle (independent of any key id). Throttles anonymous floods/guessing.
  const ipLimit = await checkRateLimit(`apikey-ip:${ip}`, 30, 60)
  if (!ipLimit.allowed) return err('Too many requests', 'rate_limited', 429, { 'Retry-After': String(ipLimit.retryAfterSeconds) })

  // 2. Strict header parse + reject key in query string.
  const url = new URL(request.url)
  if (url.searchParams.has('api_key') || url.searchParams.has('apikey')) {
    return err('API key must be sent in the Authorization header, not the query string', 'key_in_query', 400)
  }
  const presented = parseBearerKey(request.headers.get('authorization'))
  if (!presented) {
    await checkRateLimit(`apikey-fail:${ip}`, 10, 60) // count failed attempts
    return err('Missing or malformed API key', 'unauthorized', 401)
  }

  // 3. Hash + lookup (service-role). Fail CLOSED: DB error => 503, not allow.
  const supabase = createServerClient()
  const { data: key, error: lookupError } = await (supabase
    .from('api_keys') as any)
    .select('id, user_id, status, rate_limit_per_min')
    .eq('key_hash', hashApiKey(presented))
    .maybeSingle()

  if (lookupError) return err('Auth service unavailable', 'auth_unavailable', 503)
  if (!key || key.status !== 'active') {
    await checkRateLimit(`apikey-fail:${ip}`, 10, 60)
    return err('Invalid API key', 'unauthorized', 401)
  }

  // 4. Load owner role + wallet.
  const { data: user } = await (supabase.from('users') as any)
    .select('id, role').eq('id', key.user_id).single()
  const { data: wallet } = await (supabase.from('wallets') as any)
    .select('id, balance').eq('user_id', key.user_id).single()
  if (!user || !wallet) return err('Account not provisioned', 'account_error', 500)

  // 5. Per-key rate limit.
  const keyLimit = await checkRateLimit(`apikey:${key.id}`, key.rate_limit_per_min, 60)
  if (!keyLimit.allowed) return err('Rate limit exceeded', 'rate_limited', 429, { 'Retry-After': String(keyLimit.retryAfterSeconds) })

  // 6. Best-effort last_used_at.
  void (supabase.from('api_keys') as any).update({ last_used_at: new Date().toISOString() }).eq('id', key.id)

  return { keyId: key.id, user: { id: user.id, role: user.role }, wallet: { id: wallet.id, balance: Number(wallet.balance) }, supabase }
}
```

- [ ] **Step 2: `npx tsc --noEmit` — exit 0. Commit**
```bash
git add lib/require-api-key.ts
git commit -m "feat(api): requireApiKey auth helper (pre-auth throttle, fail-closed lookup)"
```

---

## PHASE 3 — Shared order service

### Task 5: Extract `placeOrder()` (debit-first) and refactor the cookie route

**Files:**
- Create: `lib/orders.ts`, `lib/orders.test.ts`
- Modify: `app/api/orders/purchase/route.ts`

Context: read `app/api/orders/purchase/route.ts` fully first. Move the package-lookup → price → wallet → debit → order-insert logic into `placeOrder`, switching to **debit-first** ordering. The route keeps its cookie auth + notification side-effects and calls `placeOrder`.

- [ ] **Step 1: Write failing test `lib/orders.test.ts`** (pure branches with a fake supabase)
```ts
import { describe, it, expect } from 'vitest'
import { placeOrder } from './orders'

// Minimal fake of the service-role client capturing the path through placeOrder.
function fakeSupabase(opts: { pkg?: any; existing?: any; debitOk?: boolean }) {
  return {
    from(table: string) {
      const api: any = {
        select: () => api, eq: () => api, is: () => api,
        maybeSingle: async () => ({ data: table === 'orders' ? (opts.existing ?? null) : null, error: null }),
        single: async () => {
          if (table === 'data_packages') return { data: opts.pkg ?? null, error: opts.pkg ? null : { code: 'PGRST116' } }
          if (table === 'wallets') return { data: { id: 'w1', balance: 100 }, error: null }
          if (table === 'users') return { data: { role: 'user' }, error: null }
          return { data: null, error: null }
        },
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'o1', reference_code: 'LASTHOPE-X' }, error: null }) }) }),
        update: () => api, delete: () => api,
      }
      return api
    },
    rpc: (_fn: string) => ({ single: async () => (opts.debitOk ? { data: { balance: 90 }, error: null } : { data: null, error: { code: 'PGRST116' } }) }),
  } as any
}

describe('placeOrder', () => {
  it('404s an unknown/unavailable package', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({}))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('package_not_found')
  })
  it('returns insufficient_funds when debit matches no row', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({ pkg: { id: 'p1', price: 10, network: 'MTN', size: '1GB', is_available: true }, debitOk: false }))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('insufficient_funds')
  })
  it('returns the existing order on idempotency hit without charging', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: '+233200000000', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({ existing: { id: 'old', reference_code: 'LASTHOPE-OLD', status: 'pending' } }))
    expect(r.ok).toBe(true); if (r.ok) expect(r.reference).toBe('LASTHOPE-OLD')
  })
  it('rejects invalid phone', async () => {
    const r = await placeOrder({ userId: 'u1', packageId: 'p1', phoneNumber: 'nope', idempotencyKey: 'k1', source: 'api' }, fakeSupabase({}))
    expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe('invalid_phone')
  })
})
```

- [ ] **Step 2: Run `npx vitest run lib/orders.test.ts` — expect FAIL.**

- [ ] **Step 3: Implement `lib/orders.ts`** (debit-first; idempotency scoped to user)
```ts
import { getPriceForRole } from '@/lib/pricing'
import { generateReferenceCode } from '@/lib/utils'

export interface PlaceOrderInput {
  userId: string
  packageId: string
  phoneNumber: string
  idempotencyKey: string
  source: string // 'api' | 'purchase'
}
export type PlaceOrderResult =
  | { ok: true; reference: string; orderId: string; price: number; network: string; size: string; status: string }
  | { ok: false; code: string; message: string; httpStatus: number }

// Ghana MSISDN normalization to E.164 (+233XXXXXXXXX). Accepts 0XXXXXXXXX or 233... or +233...
export function normalizeGhanaPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const d = raw.replace(/[^\d+]/g, '')
  let m: RegExpMatchArray | null
  if ((m = d.match(/^\+?233(\d{9})$/))) return '+233' + m[1]
  if ((m = d.match(/^0(\d{9})$/))) return '+233' + m[1]
  return null
}

export async function placeOrder(input: PlaceOrderInput, supabase: any): Promise<PlaceOrderResult> {
  const { userId, packageId, idempotencyKey, source } = input
  if (!packageId || typeof packageId !== 'string') return { ok: false, code: 'invalid_package', message: 'package_id is required', httpStatus: 400 }
  if (!idempotencyKey || typeof idempotencyKey !== 'string') return { ok: false, code: 'invalid_idempotency_key', message: 'idempotency_key is required', httpStatus: 400 }
  const phone = normalizeGhanaPhone(input.phoneNumber)
  if (!phone) return { ok: false, code: 'invalid_phone', message: 'phone_number must be a valid Ghana number', httpStatus: 400 }

  // Idempotency: scoped to (user_id, idempotency_key).
  const { data: existing } = await supabase.from('orders').select('id, reference_code, status, price, network, size')
    .eq('user_id', userId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing) return { ok: true, reference: existing.reference_code, orderId: existing.id, price: Number(existing.price), network: existing.network, size: existing.size, status: existing.status }

  // Package.
  const { data: pkg } = await supabase.from('data_packages').select('*').eq('id', packageId).eq('is_available', true).single()
  if (!pkg) return { ok: false, code: 'package_not_found', message: 'Package not found or unavailable', httpStatus: 404 }

  // Role + price (server-side only).
  const { data: u } = await supabase.from('users').select('role').eq('id', userId).single()
  const charge = getPriceForRole(pkg, u?.role)

  // Wallet.
  const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', userId).single()
  if (!wallet) return { ok: false, code: 'wallet_not_found', message: 'Wallet not found', httpStatus: 404 }

  // DEBIT FIRST (atomic guard). Zero rows / PGRST116 => insufficient funds.
  const { data: debit, error: debitErr } = await supabase.rpc('debit_wallet', { p_wallet_id: wallet.id, p_amount: charge }).single()
  if (debitErr || !debit) {
    if (debitErr && debitErr.code !== 'PGRST116') return { ok: false, code: 'debit_failed', message: 'Failed to debit wallet', httpStatus: 500 }
    return { ok: false, code: 'insufficient_funds', message: 'Insufficient balance', httpStatus: 402 }
  }

  const referenceCode = generateReferenceCode()
  const { data: order, error: orderErr } = await supabase.from('orders').insert({
    user_id: userId, package_id: packageId, phone_number: phone, network: pkg.network, size: pkg.size,
    bundle_name: pkg.size, price: charge, amount: charge, cost_price: pkg.cost_price || 0,
    status: 'pending', payment_status: 'paid', reference_code: referenceCode, reference: referenceCode,
    fulfillment_method: 'auto', idempotency_key: idempotencyKey,
  }).select().single()

  if (orderErr || !order) {
    // Compensate: refund the debit (no order was created).
    await supabase.rpc('credit_wallet', { p_wallet_id: wallet.id, p_amount: charge }).single()
    return { ok: false, code: 'order_failed', message: 'Failed to create order', httpStatus: 500 }
  }

  // Ledger row (best-effort, matches existing convention).
  await supabase.from('wallet_transactions').insert({
    wallet_id: wallet.id, user_id: userId, type: 'debit', amount: charge,
    description: `Data purchase: ${pkg.size} for ${phone}`, reference: referenceCode, source, status: 'completed',
  })

  return { ok: true, reference: referenceCode, orderId: order.id, price: charge, network: pkg.network, size: pkg.size, status: 'pending' }
}
```

- [ ] **Step 4: Run `npx vitest run lib/orders.test.ts` — expect PASS (4 tests).**

- [ ] **Step 5: Refactor `app/api/orders/purchase/route.ts`** to call `placeOrder` after the existing cookie auth: keep the `getSession()` block to obtain `userId`, then `const result = await placeOrder({ userId, packageId, phoneNumber, idempotencyKey: idempotencyKey ?? crypto.randomUUID(), source: 'purchase' }, supabase)`. Map `result` to the existing response shape (`{ success: true, order: { id, reference_code, status } }` on ok; `NextResponse.json({error: result.message}, {status: result.httpStatus})` otherwise). Keep the existing notification/email/SMS side-effects (fire them after a successful result, reusing the order id/reference). Remove the now-duplicated package/price/wallet/debit/insert block. (The cookie route previously allowed a missing idempotency key; preserve that by generating one when absent.)

- [ ] **Step 6: Verify** — `npx tsc --noEmit` (exit 0); `npm test` (all pass); start dev server and confirm a logged-in purchase still works (or at least the route compiles: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/orders/purchase -X POST` → 401, not 500).

- [ ] **Step 7: Commit**
```bash
git add lib/orders.ts lib/orders.test.ts app/api/orders/purchase/route.ts
git commit -m "feat(api): shared placeOrder service (debit-first); reuse in cookie route"
```

---

## PHASE 4 — Public endpoints

### Task 6: `GET /api/v1/packages`

**Files:** Create `app/api/v1/packages/route.ts`

- [ ] **Step 1: Implement** (explicit column projection — never `cost_price`/tier columns):
```ts
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { getPriceForRole } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  const { data, error } = await (auth.supabase.from('data_packages') as any)
    .select('id, network, size, description, price, agent_price, super_agent_price, premium_agent_price, dealer_price')
    .eq('is_available', true).order('network').order('sort_order')
  if (error) return NextResponse.json({ error: 'Failed to load packages', code: 'server_error' }, { status: 500 })
  const out = (data || []).map((p: any) => ({
    id: p.id, network: p.network, size: p.size, description: p.description,
    price: getPriceForRole(p, auth.user.role), currency: 'GHS',
  }))
  return NextResponse.json({ data: out })
}
```
(The tier columns are selected only to feed `getPriceForRole` and are NOT included in the response object.)

- [ ] **Step 2: `npx tsc --noEmit` exit 0; commit**
```bash
git add app/api/v1/packages/route.ts
git commit -m "feat(api): GET /api/v1/packages with caller tier price"
```

### Task 7: `POST /api/v1/orders`

**Files:** Create `app/api/v1/orders/route.ts`

- [ ] **Step 1: Implement** (reuses `placeOrder`):
```ts
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { placeOrder } from '@/lib/orders'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  if (request.headers.get('content-type')?.includes('application/json') !== true)
    return NextResponse.json({ error: 'Content-Type must be application/json', code: 'bad_content_type' }, { status: 400 })
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_body' }, { status: 400 }) }
  const { package_id, phone_number, idempotency_key } = body || {}
  const result = await placeOrder({ userId: auth.user.id, packageId: package_id, phoneNumber: phone_number, idempotencyKey: idempotency_key, source: 'api' }, auth.supabase)
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.httpStatus })
  return NextResponse.json({ reference: result.reference, status: result.status, price: result.price, network: result.network, size: result.size, currency: 'GHS' }, { status: 201 })
}
```

- [ ] **Step 2: `npx tsc --noEmit` exit 0; commit**
```bash
git add app/api/v1/orders/route.ts
git commit -m "feat(api): POST /api/v1/orders"
```

### Task 8: `GET /api/v1/orders/[reference]`

**Files:** Create `app/api/v1/orders/[reference]/route.ts`

- [ ] **Step 1: Implement** (scoped by user_id AND reference; clean 404):
```ts
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  const { reference } = await params
  const { data, error } = await (auth.supabase.from('orders') as any)
    .select('reference_code, status, payment_status, network, size, phone_number, price, created_at')
    .eq('user_id', auth.user.id).eq('reference_code', reference).maybeSingle()
  if (error) return NextResponse.json({ error: 'Lookup failed', code: 'server_error' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Order not found', code: 'not_found' }, { status: 404 })
  return NextResponse.json({
    reference: data.reference_code, status: data.status, payment_status: data.payment_status,
    network: data.network, size: data.size, phone_number: data.phone_number, price: Number(data.price), created_at: data.created_at,
  })
}
```

- [ ] **Step 2: `npx tsc --noEmit` exit 0; commit**
```bash
git add "app/api/v1/orders/[reference]/route.ts"
git commit -m "feat(api): GET /api/v1/orders/:reference (user-scoped)"
```

### Task 9: `GET /api/v1/wallet`

**Files:** Create `app/api/v1/wallet/route.ts`

- [ ] **Step 1: Implement**
```ts
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ balance: auth.wallet.balance, currency: 'GHS' })
}
```

- [ ] **Step 2: Integration smoke (manual):** seed a test key — insert an `api_keys` row (status `active`) for the current admin user with `key_hash = HMAC-SHA256('lh_live_<known>', API_KEY_PEPPER)` via the Management API, then:
`curl -s http://localhost:3000/api/v1/wallet -H "Authorization: Bearer lh_live_<known>"` → `200 {balance,...}`; with no header → 401; with a bad key → 401. Remove the seed key after.

- [ ] **Step 3: `npx tsc --noEmit` exit 0; commit**
```bash
git add app/api/v1/wallet/route.ts
git commit -m "feat(api): GET /api/v1/wallet"
```

---

## PHASE 5 — Webhooks (SSRF-safe, signed, durable)

### Task 10: SSRF guard (`lib/ssrf-guard.ts`) — TDD

**Files:** Create `lib/ssrf-guard.ts`, `lib/ssrf-guard.test.ts`

- [ ] **Step 1: Write failing test `lib/ssrf-guard.test.ts`** (pure IP classifier)
```ts
import { describe, it, expect } from 'vitest'
import { isPrivateIp, validateWebhookUrlShape } from './ssrf-guard'

describe('ssrf-guard', () => {
  it('flags private/loopback/link-local/metadata IPs', () => {
    for (const ip of ['127.0.0.1','10.0.0.5','192.168.1.1','172.16.0.1','169.254.169.254','0.0.0.0','::1','fc00::1'])
      expect(isPrivateIp(ip)).toBe(true)
  })
  it('allows public IPs', () => {
    for (const ip of ['8.8.8.8','1.1.1.1','93.184.216.34']) expect(isPrivateIp(ip)).toBe(false)
  })
  it('shape check requires https and rejects obvious bad hosts', () => {
    expect(validateWebhookUrlShape('https://hooks.example.com/x').ok).toBe(true)
    expect(validateWebhookUrlShape('http://hooks.example.com/x').ok).toBe(false)   // not https
    expect(validateWebhookUrlShape('https://localhost/x').ok).toBe(false)
    expect(validateWebhookUrlShape('https://127.0.0.1/x').ok).toBe(false)
    expect(validateWebhookUrlShape('ftp://x').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `lib/ssrf-guard.ts`**
```ts
import dns from 'dns/promises'
import net from 'net'

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number)
    if (o[0] === 10) return true
    if (o[0] === 127) return true
    if (o[0] === 0) return true
    if (o[0] === 169 && o[1] === 254) return true        // link-local + metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true
    if (o[0] === 192 && o[1] === 168) return true
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true // CGNAT
    return false
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    if (l === '::1' || l === '::') return true
    if (l.startsWith('fc') || l.startsWith('fd')) return true // ULA
    if (l.startsWith('fe80')) return true                     // link-local
    if (l.startsWith('::ffff:')) return isPrivateIp(l.replace('::ffff:', '')) // v4-mapped
    return false
  }
  return true // not a literal IP -> treat as unsafe here (callers resolve DNS first)
}

export function validateWebhookUrlShape(raw: string): { ok: boolean; reason?: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'invalid_url' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'must_be_https' }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) return { ok: false, reason: 'private_host' }
  if (net.isIP(host) && isPrivateIp(host)) return { ok: false, reason: 'private_ip' }
  return { ok: true }
}

// Full check including DNS resolution. Returns a pinned IP to connect to, or rejects.
export async function resolveSafeWebhookTarget(raw: string): Promise<{ ok: true; ip: string; url: URL } | { ok: false; reason: string }> {
  const shape = validateWebhookUrlShape(raw)
  if (!shape.ok) return { ok: false, reason: shape.reason! }
  const u = new URL(raw)
  let addrs: { address: string }[]
  try { addrs = await dns.lookup(u.hostname, { all: true }) } catch { return { ok: false, reason: 'dns_failed' } }
  if (!addrs.length) return { ok: false, reason: 'dns_empty' }
  for (const a of addrs) if (isPrivateIp(a.address)) return { ok: false, reason: 'resolves_to_private' }
  return { ok: true, ip: addrs[0].address, url: u }
}
```

- [ ] **Step 4: Run — expect PASS (3 tests). `npx tsc --noEmit` exit 0.**

- [ ] **Step 5: Commit**
```bash
git add lib/ssrf-guard.ts lib/ssrf-guard.test.ts
git commit -m "feat(api): SSRF guard for webhook URLs"
```

### Task 11: Webhook signing + delivery (`lib/api-webhooks.ts`) — TDD signing

**Files:** Create `lib/api-webhooks.ts`, `lib/api-webhooks.test.ts`

- [ ] **Step 1: Write failing test `lib/api-webhooks.test.ts`**
```ts
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { signWebhook } from './api-webhooks'

describe('signWebhook', () => {
  it('is HMAC-SHA512 over `${timestamp}.${body}`', () => {
    const sig = signWebhook('1700000000', '{"a":1}', 'secret')
    const expected = crypto.createHmac('sha512', 'secret').update('1700000000.{"a":1}').digest('hex')
    expect(sig).toBe(expected)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `lib/api-webhooks.ts`**
```ts
import crypto from 'crypto'
import { resolveSafeWebhookTarget } from '@/lib/ssrf-guard'

export function signWebhook(timestamp: string, body: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function newWebhookSecret(): string {
  return 'whsec_' + crypto.randomBytes(32).toString('base64url')
}

// Deliver one webhook. Returns the HTTP status (or 0 on network/SSRF failure).
export async function deliverWebhook(url: string, secret: string, payload: object): Promise<number> {
  const target = await resolveSafeWebhookTarget(url)
  if (!target.ok) return 0 // blocked (SSRF/DNS) — treated as a failed attempt
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LASTHOPE-Signature': signWebhook(timestamp, body, secret),
        'X-LASTHOPE-Timestamp': timestamp,
      },
      body,
      redirect: 'manual', // never follow redirects (SSRF bypass guard)
      signal: controller.signal,
    })
    return res.status
  } catch { return 0 } finally { clearTimeout(timer) }
}
```
Note: `Date.now()` is fine in app runtime code (the no-`Date.now()` rule is only for workflow scripts).

- [ ] **Step 4: Run — expect PASS. `npx tsc --noEmit` exit 0.**

- [ ] **Step 5: Commit**
```bash
git add lib/api-webhooks.ts lib/api-webhooks.test.ts
git commit -m "feat(api): webhook signing + SSRF-safe delivery"
```

### Task 12: `setOrderStatus()` chokepoint + route admin transitions through it

**Files:** Create `lib/order-status.ts`; Modify `app/api/admin/orders/status/route.ts`, `app/api/admin/orders/refund/route.ts`, `app/api/admin/orders/batch/route.ts`

- [ ] **Step 1: Implement `lib/order-status.ts`**
```ts
const EVENT_FOR_STATUS: Record<string, string> = {
  processing: 'order.processing', completed: 'order.completed', failed: 'order.failed', refunded: 'order.refunded',
}

// Updates one order's status (+optional payment_status) and enqueues webhook deliveries
// for every active key of the order owner that subscribes to the event.
export async function setOrderStatus(
  orderId: string, newStatus: string, opts: { paymentStatus?: string }, supabase: any
): Promise<void> {
  const { data: order } = await supabase.from('orders').select('id, user_id, reference_code, status, payment_status').eq('id', orderId).single()
  if (!order) return
  const patch: any = { status: newStatus, updated_at: new Date().toISOString() }
  if (opts.paymentStatus) patch.payment_status = opts.paymentStatus
  await supabase.from('orders').update(patch).eq('id', orderId)
  if (order.status === newStatus) return // no real change

  const event = EVENT_FOR_STATUS[newStatus]
  if (!event) return
  const { data: keys } = await supabase.from('api_keys')
    .select('id, webhook_url, webhook_events').eq('user_id', order.user_id).eq('status', 'active')
  for (const k of keys || []) {
    if (!k.webhook_url || !(k.webhook_events || []).includes(event)) continue
    await supabase.from('api_webhook_deliveries').insert({
      api_key_id: k.id, event, order_id: orderId,
      payload: { event, reference: order.reference_code, status: newStatus, payment_status: opts.paymentStatus ?? order.payment_status, timestamp: new Date().toISOString() },
    })
  }
}
```

- [ ] **Step 2: Route the three admin transitions through it.** In `admin/orders/status/route.ts`, replace the direct `orders.update({status})` with `await setOrderStatus(orderId, status, {}, supabase)` (for the single-order path; keep the batch path but call `setOrderStatus` per order id, preserving the `payment_status='refunded'` skip). In `admin/orders/refund/route.ts`, after the `refund_wallet` RPC succeeds, replace the `orders.update({status:'refunded', payment_status:'refunded'})` with `await setOrderStatus(orderId, 'refunded', { paymentStatus: 'refunded' }, supabase)`. In `admin/orders/batch/route.ts`, replace the bulk `pending->processing` update by iterating the order ids through `setOrderStatus(id, 'processing', {}, supabase)`. Read each file first; preserve all existing auth, guards, and notifications.

- [ ] **Step 3: Verify** `npx tsc --noEmit` exit 0; `npm test` all pass; curl the admin routes compile (401 without auth, not 500).

- [ ] **Step 4: Commit**
```bash
git add lib/order-status.ts app/api/admin/orders/status/route.ts app/api/admin/orders/refund/route.ts app/api/admin/orders/batch/route.ts
git commit -m "feat(api): setOrderStatus chokepoint enqueues order-status webhooks"
```

### Task 13: Cron `GET /api/cron/retry-webhooks` (backoff + circuit breaker)

**Files:** Create `app/api/cron/retry-webhooks/route.ts`

- [ ] **Step 1: Implement** (mirror the CRON_SECRET auth of `app/api/cron/delete-old-orders/route.ts`, but use `crypto.timingSafeEqual`):
```ts
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServerClient } from '@/lib/supabase'
import { deliverWebhook } from '@/lib/api-webhooks'

export const dynamic = 'force-dynamic'
const MAX_ATTEMPTS = 6
const BACKOFF_SEC = [60, 300, 900, 3600, 10800, 21600] // 1m,5m,15m,1h,3h,6h

function authed(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(got), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  if (!authed(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createServerClient()
  const nowIso = new Date().toISOString()
  const { data: due } = await (supabase.from('api_webhook_deliveries') as any)
    .select('id, api_key_id, payload, attempts').in('status', ['pending', 'failed']).lte('next_attempt_at', nowIso).limit(50)
  let delivered = 0, failed = 0
  for (const d of due || []) {
    const { data: key } = await (supabase.from('api_keys') as any).select('webhook_url, webhook_secret, status').eq('id', d.api_key_id).single()
    if (!key || key.status !== 'active' || !key.webhook_url) {
      await (supabase.from('api_webhook_deliveries') as any).update({ status: 'failed', updated_at: nowIso }).eq('id', d.id)
      continue
    }
    const code = await deliverWebhook(key.webhook_url, key.webhook_secret, d.payload)
    const ok = code >= 200 && code < 300
    const attempts = d.attempts + 1
    if (ok) { delivered++; await (supabase.from('api_webhook_deliveries') as any).update({ status: 'delivered', attempts, last_response_code: code, updated_at: nowIso }).eq('id', d.id) }
    else {
      failed++
      const giveUp = attempts >= MAX_ATTEMPTS
      const next = new Date(Date.now() + (BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)] * 1000)).toISOString()
      await (supabase.from('api_webhook_deliveries') as any).update({ status: giveUp ? 'failed' : 'pending', attempts, last_response_code: code, next_attempt_at: next, updated_at: nowIso }).eq('id', d.id)
    }
  }
  return NextResponse.json({ processed: (due || []).length, delivered, failed })
}
```
(The immediate first attempt can also be made inline from `setOrderStatus`; for simplicity v1 lets the cron pick up `pending` rows on its next run. Register the cron in `vercel.json` or trigger externally, like the other crons.)

- [ ] **Step 2: `npx tsc --noEmit` exit 0; commit**
```bash
git add app/api/cron/retry-webhooks/route.ts
git commit -m "feat(api): retry-webhooks cron with backoff + circuit breaker"
```

---

## PHASE 6 — Management surfaces (admin + account holder)

### Task 14: Admin API-key management (API + page)

**Files:** Create `app/api/admin/api-keys/route.ts`, `app/admin/api-keys/page.tsx`

- [ ] **Step 1: Implement `app/api/admin/api-keys/route.ts`** — copy the structure of `app/api/admin/withdrawals/route.ts`. `GET` (requireAdmin, admin-only: `if (auth.role !== 'admin') return 403`) lists keys joined to user email (never selecting `key_hash`/`webhook_secret`): `.select('id, user_id, key_prefix, label, status, rate_limit_per_min, created_at, last_used_at')`. `PATCH` body `{ id, action: 'approve'|'revoke', rate_limit_per_min? }`: approve → `{ status:'active', approved_at, approved_by: auth.session.user.id }`; revoke → `{ status:'revoked' }`; optional `rate_limit_per_min` update. Validate `action` against an allow-list.

- [ ] **Step 2: Implement `app/admin/api-keys/page.tsx`** — `'use client'`, mirror `app/admin/users/page.tsx`: fetch `/api/admin/api-keys`, render a card/table of keys with status badge, an Approve/Revoke action (confirm() + toast), and a rate-limit input. PATCH on action; optimistic local update.

- [ ] **Step 3: Verify** `npx tsc --noEmit` exit 0; curl `/admin/api-keys` and `/api/admin/api-keys` compile (307/401, not 500).

- [ ] **Step 4: Commit**
```bash
git add app/api/admin/api-keys/route.ts app/admin/api-keys/page.tsx
git commit -m "feat(api): admin API-key approval/revoke management"
```

### Task 15: Account-holder key management (API + dashboard page)

**Files:** Create `app/api/user/api-keys/route.ts`, `app/dashboard/developer/page.tsx`

- [ ] **Step 1: Implement `app/api/user/api-keys/route.ts`** (cookie auth via `createRouteHandlerClient`, scoped to the caller):
  - `POST` (create): enforce a per-account cap (e.g. reject if the user already has ≥5 non-revoked keys → 400). Generate with `generateApiKey()`, insert `{ user_id, key_hash, key_prefix, label, status:'pending', webhook_secret: newWebhookSecret() }` via service-role, and return the **raw key once**: `{ key, prefix, status:'pending' }`.
  - `GET` (list own): `.select('id, key_prefix, label, status, rate_limit_per_min, webhook_url, webhook_events, created_at').eq('user_id', userId)` — never returns secret/hash.
  - `PATCH` (update own webhook): body `{ id, webhook_url?, webhook_events?, rotate_secret? }`. Validate `webhook_url` with `validateWebhookUrlShape` (reject non-https/private) AND `resolveSafeWebhookTarget` before saving; on `rotate_secret` set a fresh `newWebhookSecret()` and return it once. Scope the update by `.eq('user_id', userId)`.
  - `DELETE` (revoke own): set `status:'revoked'` where `id` AND `user_id` match.

- [ ] **Step 2: Implement `app/dashboard/developer/page.tsx`** — `'use client'`, mirror an existing dashboard page (e.g. `app/dashboard/my-shop/page.tsx`): "Generate API key" button (shows the raw key once in a copy box with a "store it now" warning), a list of the user's keys (prefix + status), a webhook URL field + "rotate secret" button, and a revoke action. All via fetch to `/api/user/api-keys`.

- [ ] **Step 3: Verify** `npx tsc --noEmit` exit 0; `npm test` all pass; curl the routes compile (401 without cookie).

- [ ] **Step 4: Commit**
```bash
git add app/api/user/api-keys/route.ts app/dashboard/developer/page.tsx
git commit -m "feat(api): account-holder key request + webhook management"
```

---

## PHASE 7 — Docs + verification

### Task 16: Integrator documentation

**Files:** Create `docs/api/README.md`

- [ ] **Step 1: Write `docs/api/README.md`** covering: base URL + `/api/v1`; `Authorization: Bearer lh_live_…` (header only, never query string); each endpoint with request/response examples and error codes; rate-limit/429 behavior; the webhook payload shape, headers (`X-LASTHOPE-Signature` = HMAC-SHA512 of `${timestamp}.${rawBody}`, `X-LASTHOPE-Timestamp`), and a Node verification snippet that rejects timestamps older than 5 minutes and uses `crypto.timingSafeEqual`.

- [ ] **Step 2: Commit**
```bash
git add docs/api/README.md
git commit -m "docs(api): developer API integrator reference"
```

### Task 17: Full verification

- [ ] **Step 1: `npm test`** — all unit tests pass (api-keys, rate-limit, orders, ssrf-guard, api-webhooks, plus existing roles/pricing).
- [ ] **Step 2: `npx tsc --noEmit`** — exit 0.
- [ ] **Step 3: `npm run build`** — succeeds (free port 3000 first via `netstat -ano | grep ':3000' | ... taskkill` if the dev server holds it).
- [ ] **Step 4: Manual end-to-end** (test key seeded as in Task 9): generate a key from `/dashboard/developer`, approve it in `/admin/api-keys`, then `GET /api/v1/packages`, `POST /api/v1/orders`, `GET /api/v1/orders/:reference`, `GET /api/v1/wallet`; set a `webhook_url` (use a request-bin), have an admin move the order to `completed`, run `GET /api/cron/retry-webhooks` with the CRON_SECRET, and confirm a signed delivery arrives. Confirm a private `webhook_url` (e.g. `https://127.0.0.1`) is rejected at save time.
- [ ] **Step 5: Final commit (if any cleanup)**
```bash
git add -A && git commit -m "chore(api): developer API end-to-end verification"
```

---

## Self-review notes

- **Spec coverage:** §1 data model→T1; key crypto/pepper→T2; pre-auth throttle/trusted IP→T3/T4; requireApiKey→T4; placeOrder/debit-first/per-user idempotency→T5; endpoints→T6–T9; SSRF guard→T10; signing/replay→T11/T16; setOrderStatus chokepoint→T12; durable retry/backoff/breaker→T13; admin approve/revoke (admin-only)→T14; account-holder request + webhook config + key cap→T15; docs→T16; §9 security items are distributed across T2 (entropy/parse), T4 (fail-closed, pre-auth), T5 (debit-first), T8 (scoping), T10 (SSRF), T11 (signing), T14 (admin-only), T6 (margin projection).
- **Order safety:** placeOrder is debit-first with compensating credit; idempotency is per-(user_id, key).
- **Type consistency:** `requireApiKey` returns `{keyId, user, wallet, supabase}`; `placeOrder` returns the `{ok:true,...}|{ok:false, code, message, httpStatus}` union used identically by the v1 orders route and the cookie route; `setOrderStatus(orderId, newStatus, {paymentStatus?}, supabase)` and `deliverWebhook(url, secret, payload)` / `signWebhook(timestamp, body, secret)` signatures are consistent across T11–T13.
- **Tests:** pure logic is TDD'd (api-keys, rate-limit, orders, ssrf-guard, api-webhooks); DB-bound routes are verified via tsc + curl + the manual e2e in T17.
