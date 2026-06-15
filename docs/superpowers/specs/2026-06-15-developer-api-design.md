# Developer API — Design

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Summary

A public, versioned HTTP API (`/api/v1`) that lets LASTHOPE **account holders**
integrate the platform into their own sites: list data packages at their tier
price, place data orders billed to their LASTHOPE wallet, check order status,
and check wallet balance — authenticated by per-account **API keys** that an
admin must approve. Order-status changes are delivered to the integrator via
**durable, signed outbound webhooks** (with polling as the fallback).

The design **reuses existing money/auth infrastructure** (the `getPriceForRole`
resolver, the atomic wallet RPCs, the `check_rate_limit` RPC, the `requireAdmin`
pattern) rather than reinventing it, and adds a dedicated security layer (§9)
because an external, programmatic, money-moving surface is a far larger attack
surface than the internal app.

## Requirements (from brainstorming)

1. Consumers are **account holders** integrating LASTHOPE into their own sites.
2. **Any** account holder may *request* a key; an **admin approves** it and sets
   its limits (approve/revoke + per-minute rate limit). A key is inert until
   approved.
3. v1 endpoints: **list packages + my price**, **place order**, **get order
   status**, **get wallet balance**.
4. Order-status updates via **webhooks + polling** (durable delivery with retry).
5. Orders are billed to the caller's wallet at their reseller-tier price via
   `getPriceForRole` — price is always computed server-side.

## Non-goals (v1)

- No wallet **top-up** via API (fund via the dashboard/Paystack).
- No bulk/multi-order calls (one package, one phone per request).
- No test-mode/sandbox keys.
- No per-key spend or order-count caps (admin sets the rate limit only).
- No new `developer` role — API access is gated by an `api_keys` row, not a role;
  the account keeps its existing tier (which drives pricing).

## Approach

**Approach A (chosen): reuse + durable webhooks.** Extract the money path into a
shared service, authenticate with API keys, and build a durable webhook delivery
table swept by a cron with backoff. (Rejected: duplicating the order logic — risks
money-code drift; fire-and-forget webhooks — no retries/visibility.)

---

## 1. Data model (one additive migration, then regenerate types)

```sql
-- API keys (one per issued credential; webhook config is 1:1 with the key)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,                 -- HMAC-SHA256(key, API_KEY_PEPPER) hex
  key_prefix text NOT NULL,               -- short cleartext for display only, e.g. 'lh_live_ab12'
  label text,
  status text NOT NULL DEFAULT 'pending'  -- pending | active | revoked
    CHECK (status IN ('pending','active','revoked')),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  rate_limit_per_min integer NOT NULL DEFAULT 60,
  webhook_url text,                        -- validated HTTPS public URL (see §5/§9)
  webhook_secret text,                     -- per-key signing secret (crypto.randomBytes)
  webhook_events text[] NOT NULL DEFAULT ARRAY['order.completed','order.failed','order.refunded'],
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys (user_id);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;   -- NO public policy: service-role only

-- Durable outbound webhook delivery queue/log
CREATE TABLE IF NOT EXISTS public.api_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  event text NOT NULL,                     -- order.processing|completed|failed|refunded
  order_id uuid,                           -- nullable: order may be purged later
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'   -- pending | delivered | failed
    CHECK (status IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_response_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON public.api_webhook_deliveries (status, next_attempt_at);
ALTER TABLE public.api_webhook_deliveries ENABLE ROW LEVEL SECURITY;  -- service-role only

-- Idempotency hardening: per-USER unique (NOT global — prevents cross-tenant collision/hijack)
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key
  ON public.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

Notes:
- `key_hash` uses **HMAC-SHA256(key, API_KEY_PEPPER)** where `API_KEY_PEPPER` is a
  new env secret — so a bare DB dump can't be used to confirm guessed keys offline.
- The idempotency index is **`(user_id, idempotency_key)`**, deliberately not a
  global unique on `idempotency_key` (red-team finding: a global unique lets user
  B collide/hijack user A's order).
- Global API config (default rate limit, webhook max-attempts/backoff) lives in
  `admin_settings` key/value rows, matching existing convention.

## 2. API-key authentication — `lib/require-api-key.ts`

Mirrors `lib/require-admin.ts` (returns an auth context **or** a `NextResponse`).
Flow on every `/api/v1` request:

1. **Pre-auth IP throttle (fail-closed):** `checkRateLimit('apikey-ip:'+clientIp, 30, 60)`
   and a stricter failed-attempt limiter `'apikey-fail:'+clientIp` → 429 before any
   DB work. `clientIp` comes from the **trusted platform header** (`x-vercel-forwarded-for` /
   `x-real-ip`), **not** the spoofable leftmost `x-forwarded-for` (see §9).
2. Parse `Authorization` strictly: `^Bearer (lh_live_[A-Za-z0-9_-]{40,})$`; reject
   empty/duplicate/malformed before hashing; reject a key presented in the query string.
3. `key_hash = HMAC-SHA256(key, API_KEY_PEPPER)`; `SELECT ... FROM api_keys WHERE key_hash = $1`
   via the **service-role** client. No row, or `status <> 'active'` → **401** (fail closed;
   a DB error is 503, never an allow).
4. Load owner `users.role` + `wallets` row (id, balance).
5. **Per-key** rate limit: `checkRateLimit('apikey:'+key.id, key.rate_limit_per_min, 60)`
   → 429 + `Retry-After`.
6. Best-effort `last_used_at = now()`.
7. Return `{ key, user: {id, role}, wallet: {id, balance}, supabase: serviceRoleClient }`.

**Key issuance:** `lh_live_` + `crypto.randomBytes(32)` base64url. Show the raw key
**once**; store only `key_hash` + a short `key_prefix`. No raw key is ever returned again.

## 3. Shared order service — `lib/orders.ts` `placeOrder()`

Extract the money path out of `app/api/orders/purchase/route.ts` into
`placeOrder({ userId, packageId, phoneNumber, idempotencyKey, source }, supabase)`
returning a typed result/error union. Both the cookie buy route and the API route
call it (one copy of the money logic).

Steps:
1. **Validate inputs** (uuid `packageId`, normalized E.164 `phoneNumber`, non-empty
   `idempotencyKey`).
2. **Idempotency:** look up an existing order by `(userId, idempotencyKey)`; if found,
   return it (no re-charge).
3. Package lookup (`is_available = true`) → 404 if missing.
4. `role = users.role`; `charge = getPriceForRole(pkg, role)` (never client-supplied).
5. **Debit-first ordering (closes the orphan-paid-order window):** call `debit_wallet`
   RPC; treat zero-rows/`PGRST116` as **insufficient funds** → 402. Only on a successful
   debit, insert the order (`status:'pending'`, `payment_status:'paid'`, `idempotency_key`).
   If the **insert** fails, compensate with `credit_wallet` and return 500. (Gold-standard
   alternative: a single `SECURITY DEFINER` RPC doing debit+insert in one transaction — noted
   as a follow-up hardening.) Note: `orders` has no `source` column; caller attribution is
   recorded on the ledger row in step 6, not the order.
6. Write the `wallet_transactions` ledger row (`type:'debit'`, `source` = the caller's tag,
   `'api'` for API orders / `'purchase'` for the cookie route).
7. Notifications/SMS are **caller-configurable** (the API route defaults to no end-user
   SMS; the cookie route keeps current behavior).

## 4. Public endpoints — `/api/v1/*`

All require `requireApiKey`; all queries are **scoped to `key.user_id`**; uniform error
envelope `{ "error": string, "code": string }` with **no** internal `details/code/hint`.

| Method & path | Request | Success response |
|---|---|---|
| `GET /api/v1/packages` | — | `200 { data: [{ id, network, size, description, price, currency:"GHS" }] }` — explicit column projection; **`cost_price` and per-tier columns never exposed**; `price` = `getPriceForRole(pkg, role)` |
| `POST /api/v1/orders` | `{ package_id, phone_number, idempotency_key }` (all required) | `201 { reference, status:"pending", price, network, size, currency:"GHS" }`; idempotency replay returns the original order |
| `GET /api/v1/orders/:reference` | — | `200 { reference, status, payment_status, network, size, phone_number, price, created_at }` — matched by **reference AND `user_id`**; **404** if not found / purged |
| `GET /api/v1/wallet` | — | `200 { balance, currency:"GHS" }` for `key.user_id` |

Error statuses: 400 (validation), 401 (auth), 402 (insufficient funds), 404 (not found),
429 (rate limit), 503 (auth dependency down). Body size capped; `Content-Type: application/json`
required on POST.

## 5. Outbound webhooks (durable, signed, SSRF-safe)

- **Emission chokepoint:** a shared `lib/order-status.ts` `setOrderStatus(orderId, newStatus,
  { paymentStatus, actor }, supabase)` performs the order UPDATE and, on a real change, if the
  order's owner has one or more `active` keys with a `webhook_url` subscribed to the event,
  **enqueues** an `api_webhook_deliveries` row **per such key** (an account with several
  webhook-configured keys gets a delivery to each). This covers every order owned by that
  user, regardless of whether it was placed via the API or the dashboard. Route the three
  manual-fulfillment paths through it: `app/api/admin/orders/status`,
  `app/api/admin/orders/refund`, `app/api/admin/orders/batch`.
- **Events:** `order.processing`, `order.completed`, `order.failed`, `order.refunded`. Payload
  carries **both** `status` and `payment_status`, plus `reference`, `event`, and an ISO `timestamp`.
- **Signing (replay-resistant):** header `X-LASTHOPE-Signature = HMAC-SHA512(`${timestamp}.${rawBody}`, webhook_secret)`
  and `X-LASTHOPE-Timestamp`. Integrators recompute over `timestamp.body`, compare with
  `timingSafeEqual`, and reject timestamps older than 5 minutes.
- **SSRF protection (`lib/ssrf-guard.ts`), enforced at save-time AND send-time:** require
  `https://`, resolve the host, **reject** loopback/link-local/`169.254.169.254`/RFC1918/
  non-public IPs, **pin** the resolved IP for the request, **disable redirects**, set a short
  connect/read **timeout** and a **response-size cap**.
- **Delivery + retry:** immediate attempt on enqueue; a new `GET /api/cron/retry-webhooks`
  (CRON_SECRET Bearer, `timingSafeEqual`) sweeps due `pending`/`failed` rows, retries with
  **exponential backoff** up to a **max attempts** cap, then marks permanently `failed`
  (polling is the fallback). A per-key **circuit breaker** pauses delivery to an endpoint that
  keeps failing, preventing self-inflicted outbound DoS.

## 6. Admin surface

- `app/api/admin/api-keys/route.ts` (`requireAdmin`, **admin-only** — reject `sub-admin`):
  `GET` list key requests/keys (paginated, never returns `key_hash`/`webhook_secret`);
  `PATCH` approve (`status→active`, set `approved_at/by`), revoke (`status→revoked`), and set
  `rate_limit_per_min`.
- `app/admin/api-keys/page.tsx` — list pending/active keys with approve/revoke + rate-limit
  controls (follows the `app/admin/users` page pattern).

## 7. Account-holder surface

- `app/api/user/api-keys/route.ts` (cookie-auth, scoped to the caller): `POST` request a key
  (creates `status:'pending'`, returns the raw key **once**, enforces a **per-account key cap**);
  `GET` list own keys (prefix/status only); `PATCH` set `webhook_url` (SSRF-validated) + rotate
  `webhook_secret` + `webhook_events`; `DELETE` revoke.
- `app/dashboard/developer/page.tsx` — request/copy key (once), manage webhook URL/secret, revoke.
- `docs/api/README.md` — integrator reference: auth header, endpoints, error codes, and a
  webhook signature-verification snippet.

## 8. Testing

Vitest unit tests (pure logic): key generation/format + HMAC hashing; strict `Authorization`
parsing (empty/duplicate/malformed/query-string rejection); `placeOrder` price/idempotency/
debit-first branches (mocked supabase); webhook signing (`timestamp.body` HMAC) and verification;
`ssrf-guard` IP/host classification (loopback/RFC1918/metadata/public). Manual end-to-end against
the running app for the full key→order→status-webhook flow.

## 9. Security (hardening folded in from the red-team)

**Critical**
- **SSRF on `webhook_url`** → `lib/ssrf-guard.ts` (HTTPS-only, DNS resolve + private/metadata/
  loopback/link-local block, IP pinning, no redirects, timeout + size cap), validated at save
  AND send time.
- **Cross-tenant IDOR** → every `/api/v1` query filtered by `key.user_id`; `:reference` matched
  on reference **and** `user_id`; body-supplied `user_id`/`wallet_id`/`price` never trusted.
- **Idempotency hijack** → per-`(user_id, idempotency_key)` unique index, not global.
- **Pre-auth DoS / fail-open limiter** → IP pre-auth throttle on the **trusted platform IP**;
  key-validity check **fails closed** (DB error ⇒ 503, never allow); cap `rate_limit_buckets` growth.

**High**
- Order insert+debit made **debit-first with compensating credit** (eliminates orphan-paid /
  free-fulfillment window); atomic conditional refund guard (no racy double-refund).
- Webhook **replay resistance** (signed `timestamp.body`, freshness window, `timingSafeEqual`).
- **Input validation**: E.164 `phone_number`, uuid `package_id`; never interpolate input into
  PostgREST `.or()` filters.
- **No secret/PII logging** (never log key/Authorization/body); strip `details/code/hint` from
  v1 errors; reject key in query string.
- Key management **admin-only** (not sub-admin); **per-account key cap**; **margin column
  projection** (no `cost_price`/other tiers) is mandatory.

**Medium / Low (batched)**
- Key generation must use `crypto.randomBytes` (≥256-bit); enforce min length on parse.
- `key_prefix` kept short and never echoed in unauthenticated responses.
- Webhook delivery: retry cap + circuit breaker (outbound-DoS guard); enforce TLS.
- Request body size + `Content-Type` enforcement on POST; `GET /packages` bounded result set.
- `GET /api/v1/orders/:reference` tolerates the 14-day order purge (clean 404; webhook retries
  tolerate a missing order).
- No permissive CORS for `/api/v1` (server-to-server; do not enable credentialed browser CORS).

**Residual risk (accepted):** a leaked, still-active key can spend **that account's own wallet**
until revoked — bounded by the per-key rate limit and the fact that it's the holder's own funds.
Mitigated by rotation/revoke, the pepper (offline-dump resistance), and the rate limit. This is
the expected risk model for a wallet-spending developer API.

## Affected / new files (inventory)

New: `lib/require-api-key.ts`, `lib/orders.ts` (placeOrder), `lib/order-status.ts`,
`lib/ssrf-guard.ts`, `lib/api-webhooks.ts` (sign + deliver), `app/api/v1/packages/route.ts`,
`app/api/v1/orders/route.ts`, `app/api/v1/orders/[reference]/route.ts`, `app/api/v1/wallet/route.ts`,
`app/api/cron/retry-webhooks/route.ts`, `app/api/admin/api-keys/route.ts`,
`app/api/user/api-keys/route.ts`, `app/admin/api-keys/page.tsx`, `app/dashboard/developer/page.tsx`,
`docs/api/README.md`, a migration under `migrations/`.
Modified: `app/api/orders/purchase/route.ts` (call `placeOrder`), `app/api/admin/orders/status/route.ts`,
`app/api/admin/orders/refund/route.ts`, `app/api/admin/orders/batch/route.ts` (route through
`setOrderStatus`), `lib/rate-limit.ts` (trusted client IP), `types/database.types.ts` (regen),
`.env`/`.env.example` (`API_KEY_PEPPER`).
