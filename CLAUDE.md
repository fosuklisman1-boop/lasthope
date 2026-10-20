# CLAUDE.md — LASTHOPE

Guidance for working in this repository. Read this before making changes.

> ⚠️ **There is an active, critical security backlog.** See
> [`SECURITY-REMEDIATION-PLAN.md`](./SECURITY-REMEDIATION-PLAN.md). Do not deploy
> new features before the CRITICAL items there are resolved.

---

## 1. What this is

A **Next.js 15 (App Router) e-commerce platform for selling mobile data bundles
and airtime in Ghana**. Customers fund a wallet via Paystack, then spend it on
data for MTN / Telecel / AirtelTigo numbers. Orders are recorded as `paid` /
`pending` and fulfilled **manually by an admin** — the automated MTN/CodeCraft
reseller-API fulfillment was removed for this client (see §6).

**Naming:** branded **LASTHOPE** throughout (`package.json` = `lasthope`); order
reference codes are prefixed `LASTHOPE-`.

## 2. Tech stack

| Layer        | Choice |
|--------------|--------|
| Framework    | Next.js 15.1.9, App Router, React 18 |
| DB + Auth    | Supabase (Postgres + Supabase Auth, cookie sessions) |
| Styling      | Tailwind + shadcn/ui (Radix primitives in `components/ui/`) |
| Payments     | Paystack (initialize → redirect → webhook + verify callback) |
| Fulfillment  | **Manual** (admin-handled; automated MTN/CodeCraft fulfillment removed for this client) |
| Email        | Brevo (`lib/email-service.ts`) |
| SMS          | Moolre (`lib/sms-service.ts`) |
| Hosting      | Vercel (crons + security headers in `vercel.json`) |

Scripts: `npm run dev` / `build` / `start` / `lint` / `test`. Vitest (`npm test`)
covers `lib/` pure logic (roles, pricing); there are no integration tests.

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

Roles (`lib/roles.ts` — the single source of truth): `admin`, `sub-admin`, the
four **reseller tiers** `agent` → `super-agent` → `premium-agent` → `dealer`
(progressively cheaper buying prices), then `user` (displays as "Customer").
`lib/roles.ts` exports `RESELLER_TIERS`, `isResellerRole()`, `roleConfig`, and
`TIER_PRICE_FIELD` (tier → `data_packages` price column).

**Reseller upgrades are permanent, one-time purchases** (no expiry, no plans). A
user buys a tier via `POST /api/user/upgrade/initialize` (`{ tier }`; price from
`admin_settings.upgrade_price_<tier>`), or an admin assigns it via
`/api/admin/users/role`. Every reseller tier unlocks the storefront perk. There
is **no** `agent_expires_at`, renewal cron, or auto-downgrade — all removed when
the model became permanent (use `isResellerRole(role)`, not `role === 'agent'`).

Per-tier pricing: each `data_packages` row has base `price` plus `agent_price` /
`super_agent_price` / `premium_agent_price` / `dealer_price`. **Always resolve
the charge with `getPriceForRole(pkg, role)` (`lib/pricing.ts`)** — used by both
the client buy page and the server `orders/purchase` route so a tier can't be
billed the wrong price (falls back to base `price` when a tier price is 0/unset).

Three enforcement layers:
- **`middleware.ts`** — edge gate for pages. Session required for `/dashboard`;
  `admin`/`sub-admin` role (DB lookup) for `/admin`. Wraps Supabase calls in
  `Promise.race` timeouts and forces `no-cache` headers.
- **`contexts/auth-context.tsx`** — client session state, retry-with-backoff DB
  user fetch, 1-hour inactivity auto-logout.
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
3. `POST /api/orders/purchase` checks balance, debits wallet (charge =
   `getPriceForRole(pkg, role)`), creates the order, fires
   notifications/email/SMS. The order is left `pending` for manual fulfillment.

**Flow B — Direct purchase (no wallet):** guest storefront `/s/[slug]` and
agent shops pay Paystack per-order (`GST-` ref).

**Webhook routing** (`app/api/webhooks/paystack/route.ts`):
- `metadata.target_role` / `upgrade_` prefix → `processCompletedUpgradePayment` (sets the role permanently)
- `GST-` prefix → `processCompletedShopOrder`
- else → `processCompletedWalletPayment`

**Idempotency idiom:** a conditional `UPDATE … WHERE status='pending'`. Zero rows
updated (`PGRST116`) is treated as "already processed" → returns success. Safe
against duplicate webhook deliveries.

> ⚠️ Wallet credit/debit is **read-then-write, not atomic.** Concurrent
> operations can race (double-spend / lost credit). See remediation plan §M1.

## 6. Fulfillment — manual

Automated fulfillment was **removed for this client.** Orders are created with
`status: 'pending'` / `payment_status: 'paid'` and are fulfilled **manually by an
admin** (e.g. via the admin orders page). There is no `triggerFulfillment`, no
MTN/CodeCraft provider code (`lib/mtn-fulfillment.ts` / `lib/at-ishare-service.ts`
deleted), and no `sync-mtn-status` / `sync-codecraft-status` cron routes.

Remaining crons authenticate via `isCronAuthorized` (`lib/cron-auth.ts`): `Authorization: Bearer ${CRON_SECRET}` or `?key=${CRON_SECRET}`. Only
`delete-old-orders` is registered in `vercel.json`; the rest
(`verify-pending-payments`, cleanup jobs) are expected to be triggered by an
external scheduler.

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

> ⚠️ **`phone_blacklist`** is still referenced by `orders/purchase` (anti-fraud
> check) but does NOT exist in the live schema — that query is a silent no-op.
> (The old `fulfillment_logs` / `mtn_fulfillment_tracking` references were
> removed along with the fulfillment code.)

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
- **Change a buying price** → set the per-tier columns on `data_packages` in
  admin → packages; charge resolution is centralized in `getPriceForRole`
  (`lib/pricing.ts`) — never special-case `agent_price` inline.
- **Change upgrade prices** → `admin_settings` keys `upgrade_price_<tier>` (one
  per reseller tier), edited on the admin memberships page via the
  `requireAdmin`-gated `update-prices` route.
- **Add a reseller tier / role** → extend `lib/roles.ts` (`UserRole`,
  `roleConfig`, `RESELLER_TIERS`, `TIER_PRICE_FIELD`), add a `data_packages`
  price column + `upgrade_price_<tier>` setting, and update the `users.role`
  check-constraint allow-list.
- **Add an admin API route** → copy the auth+role handshake from
  `app/api/admin/withdrawals/route.ts` (one of the correct examples).
</content>
</invoke>
