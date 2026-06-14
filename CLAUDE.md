# CLAUDE.md — LASTHOPE / LASTHOPE

Guidance for working in this repository. Read this before making changes.

> ⚠️ **There is an active, critical security backlog.** See
> [`SECURITY-REMEDIATION-PLAN.md`](./SECURITY-REMEDIATION-PLAN.md). Do not deploy
> new features before the CRITICAL items there are resolved.

---

## 1. What this is

A **Next.js 15 (App Router) e-commerce platform for selling mobile data bundles
and airtime in Ghana**. Customers fund a wallet via Paystack, then spend it on
data for MTN / Telecel / AirtelTigo numbers. Orders are fulfilled through
third-party reseller APIs and reconciled by cron jobs.

**Naming note:** the product is referred to by three names. `package.json` =
`lasthope`, README = "LASTHOPE", the live UI brands itself **"LASTHOPE"**, and order
reference codes are prefixed `LASTHOPE-`. LASTHOPE is the current public name.

## 2. Tech stack

| Layer        | Choice |
|--------------|--------|
| Framework    | Next.js 15.1.9, App Router, React 18 |
| DB + Auth    | Supabase (Postgres + Supabase Auth, cookie sessions) |
| Styling      | Tailwind + shadcn/ui (Radix primitives in `components/ui/`) |
| Payments     | Paystack (initialize → redirect → webhook + verify callback) |
| Fulfillment  | MTN API (`lib/mtn-fulfillment.ts`) + CodeCraft API (`lib/at-ishare-service.ts`) |
| Email        | Brevo (`lib/email-service.ts`) |
| SMS          | Moolre (`lib/sms-service.ts`) |
| Hosting      | Vercel (crons + security headers in `vercel.json`) |

Scripts: `npm run dev` / `build` / `start` / `lint`. No test suite exists.

## 3. The three Supabase clients (read this before any data code)

This is the single most important pattern in the codebase. Three clients with
very different privileges:

1. **`supabase`** — browser client, anon key, **respects RLS**.
   From `lib/supabase.ts`. Used in client components / contexts / hooks.
2. **`createRouteClient()`** (`lib/supabase-server.ts`) and the inline
   **`createRouteHandlerClient({ cookies })`** — reads the caller's session
   from cookies inside API routes. Respects RLS. Used to answer *"who is
   calling?"*.
3. **`createServerClient()`** (`lib/supabase.ts`) — **service-role key, bypasses
   RLS entirely.** Used for privileged writes (crediting wallets, changing
   roles). It is **not** bound to request cookies, so calling `.auth.getSession()`
   on it returns `null` — never use it to authenticate a caller.

**The intended API-route pattern is a two-client handshake:**

```ts
// 1. Authenticate with the cookie/route client (RLS) — "who is asking?"
const { data: { session } } = await routeClient.auth.getSession()
if (!session) return 401
// 2. (admin routes) verify role via DB lookup
// 3. Do privileged work with the service-role client
const svc = createServerClient()
```

⚠️ **Middleware does NOT protect `/api/*`.** `middleware.ts` matches only
`/dashboard/*`, `/admin/*`, `/auth/*` (pages). Every API route — especially
under `app/api/admin/` — must perform its **own** auth + role check. Several
currently do not (see the remediation plan).

## 4. Roles & access control

Roles: `admin`, `sub-admin`, `agent`, `user` (`lib/roles.ts`; `'user'` displays
as "Customer" in the UI). **`agent`** is the paid tier — customers pay (3 / 14 /
30-day plans) to become agents, gaining discounted `agent_price` pricing and a
public storefront. Expiry lives in `users.agent_expires_at`.

Three enforcement layers:
- **`middleware.ts`** — edge gate for pages. Session required for `/dashboard`;
  `admin`/`sub-admin` role (DB lookup) for `/admin`. Wraps Supabase calls in
  `Promise.race` timeouts and forces `no-cache` headers.
- **`contexts/auth-context.tsx`** — client session state, retry-with-backoff DB
  user fetch, 1-hour inactivity auto-logout, and **auto-downgrade of expired
  agents** (POST `/api/agent/downgrade`, which sets `role: 'user'`).
- **`hooks/use-page-access.ts`** — admins toggle individual customer pages
  on/off via `admin_settings`; the sidebar filters nav accordingly.

## 5. The two money flows

Both terminate at the Paystack webhook, which routes by reference prefix /
metadata.

**Flow A — Wallet top-up, then spend:**
1. `POST /api/payments/initialize` → creates a `pending` `wallet_payments`
   row (`WAL-` ref), computes fee from `admin_settings`, calls Paystack.
2. Paystack → `webhooks/paystack` (HMAC-SHA512 verified) **or**
   `GET /api/payments/verify` callback → `processCompletedWalletPayment`
   (`lib/payments.ts`) credits the wallet **idempotently**.
3. `POST /api/orders/purchase` checks balance, debits wallet, creates the
   order, fires notifications/email/SMS, then calls (a stubbed) fulfillment.

**Flow B — Direct purchase (no wallet):** guest storefront `/s/[slug]` and
agent shops pay Paystack per-order (`GST-` ref).

**Webhook routing** (`app/api/webhooks/paystack/route.ts`):
- `metadata.upgrade_type==='agent'` / `agent_upgrade_` → `processCompletedUpgradePayment` (extends membership)
- `GST-` prefix → `processCompletedShopOrder`
- else → `processCompletedWalletPayment`

**Idempotency idiom:** a conditional `UPDATE … WHERE status='pending'`. Zero rows
updated (`PGRST116`) is treated as "already processed" → returns success. Safe
against duplicate webhook deliveries.

> ⚠️ Wallet credit/debit is **read-then-write, not atomic.** Concurrent
> operations can race (double-spend / lost credit). See remediation plan §M1.

## 6. Fulfillment — the key surprise

Orders are **not** fulfilled at purchase time. In `orders/purchase`,
`triggerFulfillment()` is a **no-op stub** that only `console.log`s. The real
work is **pull-based** via cron:

- `app/api/cron/sync-mtn-status` and `sync-codecraft-status` poll provider
  status, update orders + `fulfillment_logs`/`mtn_fulfillment_tracking`, and
  **auto-refund the wallet on failure**. ⚠️ Both tables are missing from the
  live schema (§7) — these crons' initial `.select('*, <table>(*)')` queries
  may be erroring outright, needs runtime verification.
- MTN calls go through a hand-rolled **circuit breaker** (opens after 5
  failures, 1-min recovery) in `lib/mtn-fulfillment.ts`.

So an order sits `pending` until a cron sweep reconciles it. When tracing "where
does the data actually get sent," the answer is the cron jobs, not the purchase
route.

Crons authenticate with `Authorization: Bearer ${CRON_SECRET}`. Only
`delete-old-orders` is registered in `vercel.json`; the rest
(status sync, `verify-pending-payments`, cleanup, agent-renewal reminders) are
expected to be triggered by an external scheduler.

## 7. Data model

`types/database.types.ts` holds the real, generated Supabase schema
(`mcp__supabase__generate_typescript_types`); `types/supabase.ts` re-exports
`Database` from it (plus its own hand-written convenience interfaces like
`User`, `Order`, `Complaint`). Regenerate `database.types.ts` after any schema
migration so `lib/supabase.ts` / `lib/supabase-server.ts` (`createClient<Database>()`)
stay in sync — existing `as any` casts at call sites are still common and don't
need to be removed proactively, but new code should prefer the real types.
There is **no `schema.sql` in the repo**; the canonical schema lives only in the
Supabase project. Partial DDL is in `migrations/`.

The 15 tables that **actually exist** (per generated types): `admin_settings`,
`complaints`, `data_packages`, `download_batches`, `notifications`, `orders`,
`rate_limit_buckets`, `shop_packages`, `shops`, `system_announcements`, `users`,
`wallet_payments`, `wallet_transactions`, `wallets`, `withdrawals`
(`migrations/20260320_create_shops_and_withdrawals.sql` holds the storefront
RLS policies).

> ⚠️ **Three tables are referenced in code but do NOT exist in the live
> schema**: `phone_blacklist` (orders/purchase anti-fraud check — currently a
> silent no-op), `fulfillment_logs`, and `mtn_fulfillment_tracking` (read/written
> by the status-sync crons, see §6). These queries likely error silently. See
> SECURITY-REMEDIATION-PLAN.md §L6 follow-up.

## 8. Route map

- **Public:** `app/page.tsx` (landing), `app/auth/*`, `app/guest/*`,
  `app/s/[slug]` (agent storefronts with custom pricing via `shop_packages`).
- **`app/dashboard/*`** (customer/agent): `data-packages` (1,178-line buy page),
  `wallet`, `my-orders`, `upgrade`, `my-shop`, `afa-orders`, `complaints`,
  `notifications`, `profile`.
- **`app/admin/*`:** `orders` (1,275 lines), `users`, `packages`, `memberships`,
  `withdrawals`, `profits-history`, `sms-broadcast`, `settings`, `announcements`.
- **`app/api/*`:** mirrors the above under `admin/`, `user/`, `guest/`, `cron/`,
  `payments/`, `webhooks/`, plus the **dangerous leftover `app/api/fix-admin`**
  (delete it — see plan).

## 9. Conventions & gotchas

- Money is GHS; amounts to Paystack are in **pesewas** (`× 100`, `Math.round`).
  Reference codes via `generateReferenceCode()` (`lib/utils.ts`).
- `cn()` (clsx + tailwind-merge) for class composition; `formatCurrency` /
  `formatDate` use `en-GH`.
- Client pricing is cached in `localStorage` for 5 min (`lib/pricing-cache.ts`);
  call `clearPricingCache()` after admin price changes.
- Heavy `as any` casting predates the generated DB types (§7) and is mostly
  historical at this point — new code should type against the real `Database`
  type where practical, but removing existing casts is not a priority.
- Several routes `console.log` PII and secret-key prefixes; strip these.
- Repo root holds dev artifacts (`ngrok_url*.txt`, `initialize_response.json`,
  `.env.local.bak`). `.env.local.bak` **leaks real secrets — see plan §C1.**

## 10. Where to start for common tasks

- **Add/adjust a payment path** → `lib/payments.ts` + the webhook + the relevant
  `*/initialize` route. Preserve the idempotent `UPDATE … WHERE status='pending'`.
- **Touch fulfillment** → `lib/mtn-fulfillment.ts`, `lib/at-ishare-service.ts`,
  and the two cron sync routes (not the purchase route).
- **Add an admin API route** → copy the auth+role handshake from
  `app/api/admin/withdrawals/route.ts` (one of the correct examples).
- **Change pricing** → `admin_settings` keys `agent_upgrade_price_{3d,14d,30d}`;
  remember `update-prices` currently lacks auth (fix first).
</content>
</invoke>
