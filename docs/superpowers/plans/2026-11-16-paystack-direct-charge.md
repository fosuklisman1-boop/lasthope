# Paystack Direct Charge (MoMo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Paystack hosted-page redirect with mobile-money direct charge (`POST /charge`) on wallet top-up, storefront checkout, reseller upgrade and a new dashboard direct buy.

**Architecture:** A thin Paystack client (`lib/paystack-charge.ts`), per-purpose "prepare" functions that resolve the server-side amount and create the pending record, and three routes (`/api/pay/charge`, `/otp`, `/status`). Completion reuses the existing idempotent `process*` functions in `lib/payments.ts`; the webhook stays as the backup trigger. One shared `MomoPayDialog` replaces the redirect on every page.

**Tech Stack:** Next.js 15 App Router, Supabase (service-role client for writes), Vitest (tests live in `lib/**/*.test.ts` only, per `vitest.config.ts`), Paystack Charge API.

**Spec:** `docs/superpowers/specs/2026-11-16-paystack-direct-charge-design.md`

## Global Constraints

- MoMo only: networks `mtn | telecel | airteltigo` (Paystack providers `mtn | vod | atl`). No card.
- Amounts are computed on the server only; amounts to Paystack are pesewas (`Math.round(ghs * 100)`).
- Fees as today: topup = amount + `paystack_fee_percent` (`agent_paystack_fee_percent` for resellers) from `admin_settings`, default 1.95; storefront = price + 1.95%; upgrade = `roles.upgrade_price`, no fee; direct_buy = package price via `resolvePrice`/`getPriceForRole`, fee as topup.
- Auth on new routes: `getUser()` (never `getSession()`); privileged writes via `createServerClient()` (service role).
- Every route keeps `isPaymentMaintenance()` and `checkRateLimit()`.
- Completion stays idempotent: conditional `UPDATE ... WHERE status='pending'`; Paystack-reported amount must equal expected pesewas.
- References: topup `WAL-`, storefront `GST-`, upgrade `upgrade_`, direct buy `DBY-` (all via `generateReferenceCode()`).
- `wallet_payments.provider` stays `'paystack'`; the channel goes in `metadata.channel = 'momo_charge'` (no schema change).
- Old redirect `initialize` / `verify` routes are not modified until Task 9.
- Fulfillment stays manual. No schema migrations.

## Review Focus

1. Customer approves on phone then closes the tab: webhook or a later `/status` call must still complete it exactly once (Task 4 test).
2. Invalid phone / unsupported network / Paystack rejects the charge: no orphan `pending` row is left; row is marked `failed` (Task 2, 3 tests).
3. Double tap on Pay or a repeated `/status` poll racing the webhook: wallet credited once, role granted once, order placed once (Task 4 test).
4. Paystack-reported amount differs from expected: nothing is credited / granted / marked paid (Task 4 test).
5. Polling or submitting OTP for someone else's reference: 404, no state leaked (Task 4 test).
6. direct_buy paid but `placeOrder` fails (package pulled): wallet stays credited, state `paid_order_failed` is reported, retry heals it (Task 4 test).

---

### Task 1: Paystack charge client

**Files:**
- Create: `lib/paystack-charge.ts`
- Test: `lib/paystack-charge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MomoNetwork = 'mtn' | 'telecel' | 'airteltigo'
  export type ChargeState = 'pay_offline' | 'send_otp' | 'send_voucher' | 'success' | 'failed' | 'pending'
  export interface ChargeResult { state: ChargeState; message?: string; raw: any }
  export class PaystackChargeError extends Error {}
  export function toPaystackProvider(n: MomoNetwork): 'mtn' | 'vod' | 'atl'
  export function toLocalPhone(raw: string): string | null   // '+233551234987' | '0551234987' -> '0551234987'
  export function mapChargeStatus(s: string | undefined): ChargeState
  export function createMomoCharge(i: { email: string; amountKobo: number; reference: string; phone: string; network: MomoNetwork }, fetchImpl?: typeof fetch): Promise<ChargeResult>
  export function submitChargeOtp(i: { reference: string; code: string }, fetchImpl?: typeof fetch): Promise<ChargeResult>
  export function verifyTransaction(reference: string, fetchImpl?: typeof fetch): Promise<{ state: ChargeState; amountKobo?: number; data: any }>
  ```
- Consumes: `normalizeGhanaPhone` from `lib/orders.ts`.

- [ ] **Step 1: Write failing tests** in `lib/paystack-charge.test.ts` with a fake `fetchImpl`:
  - `toPaystackProvider('telecel') === 'vod'`, `'airteltigo' -> 'atl'`, `'mtn' -> 'mtn'`.
  - `toLocalPhone('+233551234987') === '0551234987'`, `toLocalPhone('0551234987') === '0551234987'`, `toLocalPhone('12345') === null`.
  - `mapChargeStatus`: `'pay_offline'`, `'send_otp'`, `'success'`, `'failed'`, `'timeout'`(->`failed`), `'send_voucher'`; unknown / `undefined` -> `'pending'`.
  - `createMomoCharge` posts to `https://api.paystack.co/charge` with `Authorization: Bearer <PAYSTACK_SECRET_KEY>` and body `{ email, amount, currency: 'GHS', reference, mobile_money: { phone: '0551234987', provider: 'mtn' } }`; returns `{ state: 'pay_offline' }` for a `{status:true, data:{status:'pay_offline'}}` response.
  - `createMomoCharge` throws `PaystackChargeError` with Paystack's `message` when the response is `{status:false, message:'...'}`; throws for an unparseable phone before calling fetch.
  - `verifyTransaction` GETs `/transaction/verify/<reference>` and returns `{ state: 'success', amountKobo: 2039 }` for a success payload.
- [ ] **Step 2: Run** `npx vitest run lib/paystack-charge.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the interface above in `lib/paystack-charge.ts`. Read `PAYSTACK_SECRET_KEY` lazily inside functions (so tests can set it). `submitChargeOtp` posts `{ otp: code, reference }` to `/charge/submit_otp`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pay): paystack MoMo charge client`.

---

### Task 2: Prepare functions for wallet-backed purposes (topup, upgrade, direct_buy)

**Files:**
- Create: `lib/pay/errors.ts`, `lib/pay/prepare-wallet.ts`
- Test: `lib/pay/prepare-wallet.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // errors.ts
  export class PayError extends Error { constructor(message: string, public httpStatus: number) }
  export type PayPurpose = 'topup' | 'storefront' | 'upgrade' | 'direct_buy'
  // prepare-wallet.ts
  export interface PreparedPayment { reference: string; email: string; totalAmount: number }  // totalAmount in GHS, fee included
  export function prepareTopup(sb: any, i: { userId: string; email: string; amount: number }): Promise<PreparedPayment>
  export function prepareUpgrade(sb: any, i: { userId: string; email: string; tier: string }): Promise<PreparedPayment>
  export function prepareDirectBuy(sb: any, i: { userId: string; email: string; packageId: string; phoneNumber: string }): Promise<PreparedPayment>
  export function markPaymentFailed(sb: any, reference: string): Promise<void>   // wallet_payments.status='failed' where status='pending'
  ```
- Consumes: `calculatePaystackFee`, `generateReferenceCode` (`lib/utils.ts`); `resolvePrice` + `loadPricingContext` (as in `app/api/guest/purchase/initialize/route.ts`); `normalizeGhanaPhone`.

Behavior to port (copy the logic, do not import from the old routes, which are deleted in Task 9): topup min GHS 5, get-or-create wallet, fee-setting lookup with agent rate and 1.95 fallback (from `app/api/payments/initialize/route.ts`); upgrade eligibility and price rules (from `app/api/user/upgrade/initialize/route.ts`: current role must be `user` or a reseller, target must be `upgradable`, not admin/sub-admin/user, price > 0, fee 0, metadata `{ user_id, target_role }`). Each inserts the `wallet_payments` row with `provider: 'paystack'`, `status: 'pending'`, and `metadata.channel = 'momo_charge'`. direct_buy inserts `metadata: { package_id, phone_number (normalized), channel }`, amount = resolved package price, fee on top, reference `DBY-...`.

- [ ] **Step 1: Write failing tests** with a table-keyed fake supabase (see `lib/orders.test.ts` for the pattern):
  - `prepareTopup` amount 4 throws `PayError` 400 'Minimum amount is GHS 5'.
  - `prepareTopup` amount 100 with fee setting 2 returns `totalAmount === 102`, reference starts `WAL-`, and the inserted row has `fee: 2, total_amount: 102`.
  - `prepareUpgrade` for role `admin` throws `PayError` 400; for a non-upgradable target throws 400; for valid tier returns `totalAmount === upgrade_price` and reference starts `upgrade_` with `metadata.target_role === tier`.
  - `prepareDirectBuy` with unavailable package throws 404; with bad phone throws 400; valid returns reference starting `DBY-` and inserted metadata has `package_id` and `phone_number: '+233...'`.
  - `markPaymentFailed` issues an update with `status: 'failed'` filtered on the reference and `status = 'pending'`.
- [ ] **Step 2: Run** `npx vitest run lib/pay/prepare-wallet.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions per the behavior above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pay): prepare topup/upgrade/direct-buy payments`.

---

### Task 3: Prepare function for storefront (guest) checkout

**Files:**
- Create: `lib/pay/prepare-storefront.ts`
- Test: `lib/pay/prepare-storefront.test.ts`

**Interfaces:**
- Produces: `prepareStorefront(sb: any, i: { packageId: string; phoneNumber: string; email: string; shopId?: string | null }): Promise<PreparedPayment>` and `markOrderFailed(sb: any, reference: string): Promise<void>` (sets `orders.payment_status='failed'` where `status='pending'`).
- Consumes: `PayError`, `PreparedPayment` (Task 2); `resolvePrice`, `shopPrice`, `limitsFor`, `loadShopControls`, `loadShopLimits`, `loadBlockedPackageIds`, `loadPricingContext`, `DEFAULT_SUSPENSION_MESSAGE`.

Port the pricing and order-insert logic of `app/api/guest/purchase/initialize/route.ts` (suspended shop 403, blocked bundle 400, shop controls failure 503, shop price with owner cost price and margin cap, fee 1.95%, `GST-` order insert with `payment_status: 'unpaid'`, `fulfillment_method: 'auto'`). **One deliberate change:** if shop pricing throws, fail with `PayError(503)` instead of silently falling back to the base package price (that fallback can undercharge or misprice a sale). Email and phone are required; phone normalized.

- [ ] **Step 1: Write failing tests:**
  - Missing email -> `PayError` 400.
  - Suspended shop -> `PayError` 403 with the shop's suspension message.
  - Blocked package -> 400.
  - Pricing context throws -> 503 (no fallback, no order row inserted).
  - Valid shop sale: price 10 cost 8 -> `totalAmount === 10.2` (fee rounded to 2dp), order row has `profit_amount: 2`, `reference` starts `GST-`.
  - No shopId: charges the base package price.
- [ ] **Step 2: Run** `npx vitest run lib/pay/prepare-storefront.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the notes above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pay): prepare storefront payments`.

---

### Task 4: Completion for direct buy, and state resolution (`/status` core)

**Files:**
- Modify: `lib/payments.ts` (add `processCompletedDirectBuy`)
- Create: `lib/pay/status.ts`
- Modify: `app/api/webhooks/paystack/route.ts` (route `DBY-` before the wallet fallback)
- Test: `lib/pay/status.test.ts`, `lib/payments-directbuy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/payments.ts
  export function processCompletedDirectBuy(reference: string, providerMetadata: any, sb?: any): Promise<PaymentResult & { orderFailed?: boolean }>
  // lib/pay/status.ts
  export type PayState = ChargeState | 'paid_order_failed'
  export interface Caller { userId?: string; email?: string }
  export function purposeFromReference(ref: string, metadata?: any): PayPurpose   // WAL-/GST-/DBY-/upgrade_
  export function getPaymentState(sb: any, reference: string, caller: Caller, deps?: { verify?: typeof verifyTransaction }): Promise<{ state: PayState; message?: string }>
  export function assertOwner(sb: any, reference: string, caller: Caller): Promise<void>   // throws PayError 404; getPaymentState calls it first
  ```
- Consumes: `verifyTransaction` (Task 1), `PayError` (Task 2), `processCompletedWalletPayment`, `processCompletedUpgradePayment`, `processCompletedShopOrder`, `placeOrder`.

Behavior: `processCompletedDirectBuy` first calls the existing wallet-credit path (which already verifies amount and is idempotent; `alreadyProcessed` is fine), then ALWAYS attempts `placeOrder({ userId, packageId, phoneNumber, idempotencyKey: reference, source: 'direct_buy' })` from the payment row's metadata, so a retry heals a payment that was credited but whose order failed. If `placeOrder` is not ok, return `{ success: true, orderFailed: true }` (money stays in wallet). `getPaymentState` loads the record by reference, enforces ownership (`wallet_payments.user_id === caller.userId`; for `GST-` orders `orders.email` equals `caller.email` case-insensitively; otherwise throw `PayError` 404), asks `verify`, and when verify says `success` runs the matching `process*` function then returns `success` (or `paid_order_failed`); non-success states are returned as-is; if the process function reports `Amount mismatch` return `failed`.

- [ ] **Step 1: Write failing tests** (inject a fake `verify` and fake supabase):
  - Unowned `WAL-` reference (different user) -> throws `PayError` 404; wrong guest email on `GST-` -> 404.
  - Verify returns `pay_offline` -> state `pay_offline`, no process function called.
  - Verify returns success twice (simulating webhook + poll) -> process function invoked, second call reports success without double credit (assert `credit_wallet` rpc called once, `placeOrder` called with the same idempotency key both times).
  - Verify returns success with amount != expected -> state `failed`, wallet not credited.
  - `DBY-` where `placeOrder` returns not-ok -> state `paid_order_failed`, wallet credited; a second call after `placeOrder` succeeds -> `success` and credit not repeated.
  - `purposeFromReference('upgrade_abc') === 'upgrade'`, `'DBY-1' -> 'direct_buy'`, `'GST-1' -> 'storefront'`, `'WAL-1' -> 'topup'`.
- [ ] **Step 2: Run** `npx vitest run lib/pay lib/payments-directbuy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules; in the webhook add `reference.startsWith('DBY-')` branch calling `processCompletedDirectBuy`, placed before the wallet fallback and after the upgrade/GST checks. `processCompletedWalletPayment` is reused as-is (it does not branch on `DBY-`).
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS (existing suites untouched).
- [ ] **Step 5: Commit** `feat(pay): direct-buy completion and payment state resolution`.

---

### Task 5: API routes

**Files:**
- Create: `app/api/pay/charge/route.ts`, `app/api/pay/otp/route.ts`, `app/api/pay/status/route.ts`

**Interfaces:**
- Consumes: Tasks 1-4. `createRouteClient()` (`lib/supabase-server.ts`) for `getUser()`; `createServerClient()` for writes.
- Produces (HTTP):
  - `POST /api/pay/charge` body `{ purpose, network, phone, amount?, tier?, packageId?, phoneNumber?, email?, shopId? }` -> `{ reference, state }`.
  - `POST /api/pay/otp` body `{ reference, code, email? }` -> `{ state }`.
  - `GET /api/pay/status?reference=&email=` -> `{ state, message? }`.
  - Errors: `{ error }` with `PayError.httpStatus`; 503 on maintenance; 429 on rate limit.

Flow for `charge`: maintenance check -> rate limit (per user id, or per client IP for storefront; 5/60s authed, 10/60s guest, matching today) -> authenticate (all purposes except `storefront` require `getUser()`; email taken from the authed user) -> validate `network` and `phone` (`toLocalPhone`) -> `prepare*` -> `createMomoCharge`; if it throws, call `markPaymentFailed`/`markOrderFailed` and return the Paystack message with 502. `otp` and `status` authenticate if a session exists, else use `email`, and delegate to `submitChargeOtp` / `getPaymentState` (ownership checked inside via `Caller`). `otp` must verify ownership by calling `getPaymentState`'s ownership check first (export it from `lib/pay/status.ts` as `assertOwner`).

- [ ] **Step 1: Implement** the three routes as thin adapters; no business logic beyond the flow above.
- [ ] **Step 2: Run** `npx tsc --noEmit`. Expected: no new errors in `app/api/pay/**`.
- [ ] **Step 3: Verify** with the dev server (`npm run dev`), test keys in `.env`, and curl: unauthenticated `topup` -> 401; `storefront` with no email -> 400; `status` for a random reference -> 404.
- [ ] **Step 4: Commit** `feat(pay): charge, otp and status routes`.

---

### Task 6: MoMo pay dialog

**Files:**
- Create: `components/pay/momo-pay-dialog.tsx`, `components/pay/use-momo-payment.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MomoPayDialogProps {
    open: boolean
    onOpenChange(open: boolean): void
    purpose: 'topup' | 'storefront' | 'upgrade' | 'direct_buy'
    payload: Record<string, unknown>        // purpose fields sent to /api/pay/charge
    summary: { label: string; total: number }   // shown before paying, GHS
    guestEmail?: string                      // sent on status/otp for storefront
    defaultPhone?: string
    onSuccess(reference: string): void
    onOrderFailed?(reference: string): void  // paid_order_failed
  }
  ```
  `use-momo-payment.ts` holds the state machine `idle -> charging -> pay_offline | send_otp | send_voucher -> success | failed | timeout` and polls `/api/pay/status` every 3 s for up to 120 s.
- Consumes: Task 5 routes; shadcn `Dialog`, `Input`, `Select`, `Button` from `components/ui/`.

UI: network select (MTN / Telecel / AirtelTigo), phone input, total shown, Pay button disabled while charging (prevents double tap). Waiting state text: "Approve the payment prompt on your phone". `send_otp` / `send_voucher` states show a code input that posts to `/api/pay/otp`. On `timeout` show "Still waiting. If you approved, your balance/order will update shortly" and do not offer a second charge for the same attempt without a new Pay press.

- [ ] **Step 1: Implement** hook and dialog.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npm run lint`. Expected: clean for the new files.
- [ ] **Step 3: Commit** `feat(pay): MoMo pay dialog`.

---

### Task 7: Wire the four redirect pages

**Files:**
- Modify: `app/dashboard/wallet/page.tsx:~185-200`, `app/dashboard/upgrade/page.tsx:~169-176`, `app/s/[slug]/page.tsx:~94-109`, `app/guest/purchase/page.tsx:~154-169`

For each page, replace the `fetch(.../initialize)` + `window.location.href = data.authorization_url` with opening `MomoPayDialog` with the right `purpose` and `payload`, and on `onSuccess` refresh the page data (wallet balance, role/auth context, or navigate to `/s/order/<reference>?success=true` for storefront/guest). Keep each page's existing amount/fee preview and validation. Do not delete the old routes.

- [ ] **Step 1: Modify** the four pages as described.
- [ ] **Step 2: Run** `npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 3: Verify** in a browser (dev server, Paystack test mode and Paystack's documented MoMo test numbers): top up GHS 5 -> wallet increases once; guest storefront order -> `/s/order/<ref>` shows paid; upgrade -> role changes.
- [ ] **Step 4: Commit** `feat(pay): use direct charge on wallet, upgrade and storefront`.

---

### Task 8: Dashboard "Pay now" direct buy

**Files:**
- Modify: `app/dashboard/data-packages/page.tsx` (add a "Pay now with MoMo" action next to the existing wallet purchase; placement is the implementer's call)

Opens `MomoPayDialog` with `purpose: 'direct_buy'`, `payload: { packageId, phoneNumber }`, `summary.total` = package price + fee preview (fee percent as shown on the wallet page). `onSuccess` shows the order-placed toast and refreshes orders; `onOrderFailed` shows "Payment received and added to your wallet; order could not be placed" and refreshes the wallet.

- [ ] **Step 1: Modify** the page.
- [ ] **Step 2: Run** `npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 3: Verify** in browser (test mode): pay for a bundle -> order appears in My Orders and wallet net change is zero; pull the package (`is_available=false`) mid-flow -> wallet keeps the credit and the failure message shows.
- [ ] **Step 4: Commit** `feat(pay): direct buy on data packages page`.

---

### Task 9: Signed-webhook test script, go-live, and cleanup

**Files:**
- Create: `scripts/test-webhook.ts` (posts a signed `charge.success` for a given reference/amount to a local URL)
- Modify: `.env`, Vercel env vars (user action), `CLAUDE.md` §5
- Delete (only after user confirms live success): `app/api/payments/initialize/route.ts`, `app/api/payments/verify/route.ts`, `app/api/user/upgrade/initialize/route.ts`, `app/api/guest/purchase/initialize/route.ts`, `app/api/guest/purchase/verify/route.ts`

- [ ] **Step 1: Implement** `scripts/test-webhook.ts` (HMAC-SHA512 of the body with `PAYSTACK_SECRET_KEY`, header `x-paystack-signature`); run it against a pending test reference. Expected: wallet credited / order paid; running it twice changes nothing.
- [ ] **Step 2: Ask the user** to put test keys in `.env`, confirm Paystack MoMo is enabled on the client account, and register `https://<domain>/api/webhooks/paystack`.
- [ ] **Step 3: Run** the full flows in test mode (Tasks 7-8 verifications) and `npx vitest run`. Expected: all PASS.
- [ ] **Step 4: With the user's go-ahead**, switch to live keys, run one real small MoMo payment on each surface, then delete the old redirect routes and update `CLAUDE.md` §5 to describe direct charge.
- [ ] **Step 5: Commit** `chore(pay): remove redirect flow, document direct charge`.
