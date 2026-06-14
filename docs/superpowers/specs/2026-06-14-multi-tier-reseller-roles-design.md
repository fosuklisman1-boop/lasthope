# Multi-Tier Reseller Roles & Pricing — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

Extend the platform's single paid reseller tier (`agent`) into a four-tier
reseller ladder, where each tier gets its own exact buying price per data
package. All reseller upgrades become **one-time permanent purchases** (the
existing time-based Agent membership — plans, expiry, renewal, auto-downgrade —
is retired). Tiers are acquired either by self-serve purchase or admin
assignment, and every reseller tier unlocks the existing storefront perk.

## Requirements (from brainstorming)

1. Add 3 new roles: **Super Agent**, **Premium Agent**, **Dealer**.
2. Pricing ladder, base price → cheapest:
   `Customer → Agent → Super Agent → Premium Agent → Dealer`.
3. Pricing model: **exact price per tier per package** (admin types each).
4. Membership: **one-time permanent** for all reseller tiers (no expiry).
   The existing Agent tier is converted to this model too.
5. Acquisition: purchasable by the user **or** assignable by an admin
   (mirrors how `agent` works today).
6. Perks: every reseller tier unlocks the storefront (My Shop / `/s/[slug]`).
   Tiers differ only by buying price.

## Non-goals

- No discount-percentage pricing (exact prices chosen).
- No per-tier custom plan durations (all permanent, one-time).
- No normalized pricing table (Approach A — columns — was chosen).
- No changes to `admin` / `sub-admin` privileges.

## Approach: price columns on `data_packages` (Approach A)

Mirrors the existing `agent_price` column model. Lowest-risk, no joins, and
forces a useful cleanup: a single price-resolution helper replaces today's
scattered inline role checks.

## Roles & single source of truth

Role slugs (hyphenated, matching `sub-admin`): `super-agent`, `premium-agent`,
`dealer`. Ladder order (base → cheapest): `user` → `agent` → `super-agent` →
`premium-agent` → `dealer`.

`lib/roles.ts` becomes the single source of truth:
- Extend the `UserRole` union and `roleConfig` (icon / label / rank / colors)
  with the 3 new tiers.
- Add `RESELLER_TIERS: UserRole[]` — ordered `['agent','super-agent','premium-agent','dealer']`.
- Add `isResellerRole(role): boolean`.
- Add `TIER_PRICE_FIELD: Record<UserRole, keyof DataPackage>` mapping each
  reseller tier to its price column (`agent → agent_price`,
  `super-agent → super_agent_price`, `premium-agent → premium_agent_price`,
  `dealer → dealer_price`).

Labels: Super Agent, Premium Agent, Dealer. Ranks shift so Dealer is the
top-earning reseller tier; admin/sub-admin remain ranks #1/#2.

## Data model changes

Migration file under `migrations/`, then regenerate
`types/database.types.ts` from the live project and adjust `types/supabase.ts`
convenience interfaces.

1. `data_packages`: add `super_agent_price`, `premium_agent_price`,
   `dealer_price` — `numeric default 0` (same shape/semantics as `agent_price`).
2. `users.role` check constraint: drop and recreate to add `super-agent`,
   `premium-agent`, `dealer` (keep existing `admin`, `sub-admin`, `agent`,
   `customer`, `user`).
3. `admin_settings`: remove the time-based keys `agent_upgrade_price_3d`,
   `agent_upgrade_price_14d`, `agent_upgrade_price_30d`. Add one-time keys:
   `upgrade_price_agent`, `upgrade_price_super_agent`,
   `upgrade_price_premium_agent`, `upgrade_price_dealer`.
4. `users.agent_expires_at`: **drop the column** (no expiry in the permanent
   model). All code references are removed first (see "Retire expiry machinery").

## Price resolution (core cleanup)

New `lib/pricing.ts` `getPriceForRole(pkg, role): number`:
- If `role` is a reseller tier and `pkg[TIER_PRICE_FIELD[role]] > 0`, return it.
- Otherwise return base `pkg.price` (covers customer, admin, sub-admin, and any
  reseller tier whose price is left at 0 — same fallback `agent_price` uses today).

This replaces inline logic in:
- `app/dashboard/data-packages/page.tsx` (client display, ~line 191)
- `app/api/orders/purchase/route.ts` (server-authoritative charge)
- `app/api/guest/purchase/initialize/route.ts`
- `app/dashboard/my-shop/page.tsx` and shop pricing paths

The server-side charge in `orders/purchase` MUST use the same helper as the
client so a tier cannot be charged the wrong price.

## One-time upgrade flow (multi-tier)

- `app/dashboard/upgrade/page.tsx`: render the 4 reseller tiers as cards, each
  showing its one-time price (from the new `upgrade_price_*` settings) and the
  buying benefit. User selects a tier to purchase.
- `app/api/user/upgrade/initialize/route.ts`: accept a `tier` param (replacing
  `plan`). Validate it is one of `RESELLER_TIERS`. Look up
  `upgrade_price_<tier>`. Create the pending `wallet_payments` row with
  `reference` prefix `upgrade_` and `metadata.target_role = <tier>`
  (replacing `upgrade_type:'agent'` + `plan_*`). No fee, exact price.
- `lib/payments.ts`:
  - Upgrade detection: `metadata.target_role` present OR `reference` starts with
    `upgrade_` (keep `agent_upgrade_` recognized for safety, though the fresh DB
    has no legacy rows).
  - `processCompletedUpgradePayment`: set `role = metadata.target_role`,
    `status: 'active'`. Remove the `plan_days` / `agent_expires_at` expiry math.
- Eligibility: a user may purchase any reseller tier when their current role is
  `user` or a reseller tier (lets users move between tiers). `admin` /
  `sub-admin` are not eligible to purchase.

## Retire expiry / plans / downgrade machinery

Because all tiers are permanent, remove:
- Auto-downgrade of expired agents in `contexts/auth-context.tsx`.
- `app/api/agent/downgrade/route.ts` (delete route).
- `app/api/cron/agent-renewal-reminder/route.ts` (delete route).
- `components/agent-expiry-modal.tsx` (delete; remove its usages).
- `app/api/admin/extend-agent/route.ts` (delete; no expiry to extend).
- 3/14/30-day plan selection UI in the upgrade page.
- All reads/writes of `users.agent_expires_at` (then drop the column).

`app/admin/memberships/page.tsx`: becomes a per-tier member list (group users by
reseller role) with no expiry columns; admin can still change a user's tier.

## Admin configuration

- `app/admin/packages/page.tsx`: add 3 price inputs (Super Agent / Premium Agent
  / Dealer) to the package form `PackageFormData`, defaults, and submit body.
- `app/api/admin/update-prices/route.ts` and
  `app/api/admin/get-prices/route.ts`: include the new `data_packages` price
  columns and the four `upgrade_price_*` settings.
- `app/admin/users/page.tsx` + `app/api/admin/users/role/route.ts`: add the 3
  new roles to the assignable role list and validation.

## Storefront access

Broaden every `role === 'agent'` gate that controls storefront/shop features to
`isResellerRole(role)`. Known sites: My Shop page/access, shop creation, and any
agent-only nav in `components/dashboard/sidebar.tsx` and
`app/dashboard/layout.tsx`. Role badges (`roleConfig`) update automatically once
the new entries exist.

## Display & badges

Sidebar, profile, and any role badge read from `roleConfig`, so adding the 3
entries covers the UI. Confirm `lib/roles.ts` `UserRole` is the type used by
those components (replace any local `'agent'` string unions).

## Risks & mitigations

- **Role constraint / column drop:** removing `agent_expires_at` requires all
  references gone first; do code removal before the drop migration.
- **Price-charge mismatch:** client and server must both call
  `getPriceForRole`; add the helper first and route both through it.
- **Webhook compatibility:** upgrade detection keys on `target_role`; the fresh
  client DB has no in-flight legacy `agent_upgrade_` payments, so risk is low.
- **No test suite:** verify via the running dev app — purchase/assign each tier,
  confirm the correct per-tier price is charged and storefront unlocks.

## Affected files (inventory)

Schema/types: `migrations/*` (new), `types/database.types.ts`,
`types/supabase.ts`.
Core: `lib/roles.ts`, `lib/pricing.ts` (new), `lib/payments.ts`.
Buy/charge: `app/dashboard/data-packages/page.tsx`,
`app/api/orders/purchase/route.ts`, `app/api/guest/purchase/initialize/route.ts`,
`app/dashboard/my-shop/page.tsx`.
Upgrade: `app/dashboard/upgrade/page.tsx`,
`app/api/user/upgrade/initialize/route.ts`.
Admin: `app/admin/packages/page.tsx`, `app/api/admin/update-prices/route.ts`,
`app/api/admin/get-prices/route.ts`, `app/admin/users/page.tsx`,
`app/api/admin/users/role/route.ts`, `app/admin/memberships/page.tsx`.
Retire: `contexts/auth-context.tsx`, `app/api/agent/downgrade/route.ts`,
`app/api/cron/agent-renewal-reminder/route.ts`,
`components/agent-expiry-modal.tsx`, `app/api/admin/extend-agent/route.ts`.
Display: `components/dashboard/sidebar.tsx`, `app/dashboard/layout.tsx`,
`app/dashboard/profile/page.tsx`.
