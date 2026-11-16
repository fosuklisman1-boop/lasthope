# Paystack Direct Charge (Mobile Money) — Design

Status: DRAFT, awaiting approval. Date: 2026-11-16.

## Intent
Replace the Paystack hosted-page redirect with **direct charge** (`POST /charge`,
mobile money) on every payment surface, so customers pay inside our UI by
approving a prompt on their phone. Go live with the new client's Paystack keys
once proven in test mode.

## Goals
- MoMo (MTN, Telecel, AirtelTigo) direct charge on: wallet top-up, storefront
  checkout (`/s/[slug]` and `/guest/purchase`), reseller upgrade, and a new
  dashboard "pay now" direct buy.
- One shared server core and one shared UI dialog, not four copies.
- Same idempotent completion logic as today (`lib/payments.ts`), reachable from
  three triggers: webhook, status poll, and (during rollout) legacy verify.

## Non-goals
- Card payments (explicitly dropped: no PCI scope, no 3DS handling).
- Changing fee rates, pricing logic, or fulfillment (still manual).
- Removing the redirect flow before direct charge is proven in test mode.

## Anti-goals
- Never trust a client-supplied amount, role, or price.
- Never credit a wallet / mark an order paid / grant a role twice.
- Never leave a customer charged with no record of what they bought.

## Constraints
- CLAUDE.md: security backlog is open; new routes must use `getUser()` (not
  `getSession()`) for auth and service-role client for writes.
- Webhook routing is by reference prefix / metadata; keep it.
- Paystack Ghana MoMo needs the channel enabled on the client's account; test
  mode uses Paystack's documented MoMo test numbers.

## Approaches considered
- A. Patch each route separately: rejected, charge/OTP/poll logic duplicated 4x.
- **B. Shared core + thin surfaces: chosen (user-approved).**
- C. Webhook-only, no polling: rejected, page hangs if webhook is late.

## Design (approach B)

### Server
- `lib/paystack-charge.ts`: `createMomoCharge`, `submitChargeOtp`,
  `verifyTransaction`. Only place that talks to Paystack `/charge`.
  Phone normalized via existing `normalizeGhanaPhone`; provider map
  `mtn | vod | atl`.
- `POST /api/pay/charge` body `{ purpose, phone, network, ...purposeFields }`.
  `purpose` in `topup | storefront | upgrade | direct_buy`.
  Server resolves amount per purpose, creates the pending row, calls
  `/charge`, returns `{ reference, state }` where state is one of
  `pay_offline | send_otp | send_voucher | success | failed`.
- `POST /api/pay/otp` `{ reference, code }` -> `/charge/submit_otp`.
- `GET /api/pay/status?reference=` -> `verifyTransaction`; on `success`, runs the
  matching idempotent `process*` function; returns `{ state }`. Polled by UI
  every ~3s for up to ~2 min, then shows "still waiting, check order/wallet".
- Auth: topup/upgrade/direct_buy require a logged-in user (`getUser()`);
  storefront is guest (email required, rate-limited by IP as today).
  `/api/pay/status` and `/otp` only act on references the caller owns
  (user id match) or guest references presented with the matching email/phone.
- Rate limits and `isPaymentMaintenance()` carried over from current routes.

### Amount and fee per purpose (unchanged behavior)
- topup: amount + `paystack_fee_percent` (agent rate for resellers) on top.
- storefront: shop-resolved price + 1.95% (existing pricing code reused).
- upgrade: `roles.upgrade_price`, no fee.
- direct_buy: package price via `getPriceForRole`, + fee as topup.

### direct_buy (new)
Modeled as "top up exactly the package price, then place the order":
charge creates a `wallet_payments` row (`DBY-` ref, metadata `{package_id,
phone_number}`); on success the wallet is credited then the existing
`placeOrder` (debit-first, idempotencyKey = reference) runs. If `placeOrder`
fails after payment (package gone etc.) the money stays in the wallet and the
user is told. Reuses all existing order/notification code; no new order path.

### Completion
Existing `processCompletedWalletPayment` / `processCompletedUpgradePayment` /
`processCompletedShopOrder` stay the single source of truth. Add a `DBY-`
branch (wallet credit + `placeOrder`) in `lib/payments.ts` and in webhook
routing. Webhook remains the backup trigger. Amount check against Paystack's
reported amount stays on every path.

### Client
- `components/pay/momo-pay-dialog.tsx`: phone + network form, "approve on your
  phone" waiting state, OTP/voucher input when `state` requires it, polling,
  success/failed/timeout states. Props: `purpose`, `payload`, `onSuccess`.
- Replace `window.location.href = authorization_url` in:
  `app/dashboard/wallet/page.tsx`, `app/dashboard/upgrade/page.tsx`,
  `app/s/[slug]/page.tsx`, `app/guest/purchase/page.tsx`.
- Add "Pay now with MoMo" to `app/dashboard/data-packages/page.tsx`.

### Rollout
1. Build behind the new routes; old initialize/verify routes untouched.
2. Test with test keys + Paystack MoMo test numbers + a signed-webhook script.
3. Switch the four pages over; keep old routes one release.
4. Put live keys in `.env` / Vercel, register webhook, delete old redirect
   routes.

### Testing
Vitest for `lib/paystack-charge.ts` (mocked fetch), amount resolution per
purpose, idempotent completion (double webhook + poll race), and ownership
checks on `/status` and `/otp`.

## Left to the builder
- Exact polling cadence and timeout copy.
- Whether `wallet_payments.provider` needs a `paystack_charge` value (check the
  column constraint before choosing).
- Where the "Pay now" button sits on the buy page.

## My calls (not user-decided)
- Fees stay passed to the customer as today.
- direct_buy implemented as topup-then-placeOrder.
- Old redirect routes kept until direct charge is proven.
