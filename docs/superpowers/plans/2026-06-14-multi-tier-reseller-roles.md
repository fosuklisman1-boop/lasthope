# Multi-Tier Reseller Roles & Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three permanent reseller tiers (Super Agent, Premium Agent, Dealer) above the existing Agent tier, each with its own exact per-package price, purchasable one-time or admin-assigned, all unlocking the storefront.

**Architecture:** Approach A — add price columns to `data_packages`, centralize role/price logic in `lib/roles.ts` + a new `lib/pricing.ts`, convert the upgrade flow to permanent one-time purchases keyed on a `target_role`, and retire the time-based expiry/plan/downgrade machinery.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (Postgres + Auth), Paystack, Vitest (added in Task 1 for unit-testing pure logic).

**Spec:** `docs/superpowers/specs/2026-06-14-multi-tier-reseller-roles-design.md`

**Testing note:** The app has no test suite and no integration-test harness for Next routes. This plan TDDs the *pure, high-risk logic* (role tiers + price resolution) with Vitest, and verifies routes/UI by running the dev app (`npm run dev`, port 3001) plus `npx tsc --noEmit`. Each task ends with a commit.

**Supabase note:** DB migrations are applied to project `jiuftcsomwnbnjikrbdp` via the `mcp__supabase__apply_migration` tool. If the MCP server is not connected to that project, use the Management API fallback shown in Task 4.

---

## Task 1: Add Vitest for unit-testing pure logic

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/__tests__/smoke.test.ts`

- [ ] **Step 1: Install Vitest (dev dependency)**

Run: `npm install -D vitest@^2`
Expected: `vitest` added to `devDependencies`, no errors.

- [ ] **Step 2: Add the test script**

In `package.json`, inside `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 4: Create a smoke test `lib/__tests__/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run the test**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/__tests__/smoke.test.ts
git commit -m "test: add vitest for unit-testing pure logic"
```

---

## Task 2: Extend `lib/roles.ts` with the new tiers and helpers (TDD)

**Files:**
- Modify: `lib/roles.ts`
- Test: `lib/roles.test.ts`

- [ ] **Step 1: Write the failing test `lib/roles.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { roleConfig, RESELLER_TIERS, isResellerRole, TIER_PRICE_FIELD, UserRole } from './roles'

describe('roles', () => {
  it('has config entries for all new tiers', () => {
    for (const r of ['super-agent', 'premium-agent', 'dealer'] as UserRole[]) {
      expect(roleConfig[r]).toBeDefined()
      expect(roleConfig[r].label.length).toBeGreaterThan(0)
    }
  })

  it('orders reseller tiers base->cheapest', () => {
    expect(RESELLER_TIERS).toEqual(['agent', 'super-agent', 'premium-agent', 'dealer'])
  })

  it('identifies reseller roles', () => {
    expect(isResellerRole('agent')).toBe(true)
    expect(isResellerRole('dealer')).toBe(true)
    expect(isResellerRole('user')).toBe(false)
    expect(isResellerRole('admin')).toBe(false)
  })

  it('maps each tier to its price column', () => {
    expect(TIER_PRICE_FIELD['agent']).toBe('agent_price')
    expect(TIER_PRICE_FIELD['super-agent']).toBe('super_agent_price')
    expect(TIER_PRICE_FIELD['premium-agent']).toBe('premium_agent_price')
    expect(TIER_PRICE_FIELD['dealer']).toBe('dealer_price')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/roles.test.ts`
Expected: FAIL (RESELLER_TIERS / isResellerRole / TIER_PRICE_FIELD not exported).

- [ ] **Step 3: Implement in `lib/roles.ts`**

Replace the `UserRole` type and add the new config + helpers. Full file:

```ts
import { Crown, Star, BadgeCheck, Gem, Award, Briefcase, UserCircle, LucideIcon } from 'lucide-react'

export type UserRole =
  | 'admin'
  | 'sub-admin'
  | 'agent'
  | 'super-agent'
  | 'premium-agent'
  | 'dealer'
  | 'user'

interface RoleConfigItem {
  icon: LucideIcon
  label: string
  rank: string
  color: string
  bgColor: string
  textColor: string
}

export const roleConfig: Record<UserRole, RoleConfigItem> = {
  'admin': { icon: Crown, label: 'Admin', rank: '#1', color: '#E60000', bgColor: 'rgba(230, 0, 0, 0.1)', textColor: '#E60000' },
  'sub-admin': { icon: Star, label: 'Sub-Admin', rank: '#2', color: '#FACC15', bgColor: 'rgba(250, 204, 21, 0.15)', textColor: '#B59410' },
  'dealer': { icon: Briefcase, label: 'Dealer', rank: '#3', color: '#7C3AED', bgColor: 'rgba(124, 58, 237, 0.1)', textColor: '#7C3AED' },
  'premium-agent': { icon: Gem, label: 'Premium Agent', rank: '#4', color: '#0EA5E9', bgColor: 'rgba(14, 165, 233, 0.1)', textColor: '#0EA5E9' },
  'super-agent': { icon: Award, label: 'Super Agent', rank: '#5', color: '#F59E0B', bgColor: 'rgba(245, 158, 11, 0.1)', textColor: '#B45309' },
  'agent': { icon: BadgeCheck, label: 'Agent', rank: '#6', color: '#25D366', bgColor: 'rgba(37, 211, 102, 0.1)', textColor: '#25D366' },
  'user': { icon: UserCircle, label: 'Customer', rank: '#7', color: '#0056B3', bgColor: 'rgba(0, 86, 179, 0.1)', textColor: '#0056B3' },
}

// Reseller tiers ordered base price -> cheapest (best) price.
export const RESELLER_TIERS: UserRole[] = ['agent', 'super-agent', 'premium-agent', 'dealer']

export function isResellerRole(role: string | null | undefined): boolean {
  return !!role && (RESELLER_TIERS as string[]).includes(role)
}

// Maps each reseller tier to its data_packages price column.
export const TIER_PRICE_FIELD: Record<string, string> = {
  'agent': 'agent_price',
  'super-agent': 'super_agent_price',
  'premium-agent': 'premium_agent_price',
  'dealer': 'dealer_price',
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/roles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck (lucide icons exist)**

Run: `npx tsc --noEmit`
Expected: exit 0. (`Gem`, `Award`, `Briefcase` are valid `lucide-react` icons.)

- [ ] **Step 6: Commit**

```bash
git add lib/roles.ts lib/roles.test.ts
git commit -m "feat(roles): add super-agent, premium-agent, dealer tiers + helpers"
```

---

## Task 3: Add `getPriceForRole` price resolver (TDD)

**Files:**
- Create: `lib/pricing.ts`
- Test: `lib/pricing.test.ts`

- [ ] **Step 1: Write the failing test `lib/pricing.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { getPriceForRole } from './pricing'

const pkg = {
  price: 10,
  agent_price: 9,
  super_agent_price: 8,
  premium_agent_price: 7,
  dealer_price: 6,
}

describe('getPriceForRole', () => {
  it('charges base price to customers and admins', () => {
    expect(getPriceForRole(pkg, 'user')).toBe(10)
    expect(getPriceForRole(pkg, 'admin')).toBe(10)
    expect(getPriceForRole(pkg, 'sub-admin')).toBe(10)
  })

  it('charges each reseller tier its own price', () => {
    expect(getPriceForRole(pkg, 'agent')).toBe(9)
    expect(getPriceForRole(pkg, 'super-agent')).toBe(8)
    expect(getPriceForRole(pkg, 'premium-agent')).toBe(7)
    expect(getPriceForRole(pkg, 'dealer')).toBe(6)
  })

  it('falls back to base price when a tier price is 0/unset', () => {
    expect(getPriceForRole({ price: 10, dealer_price: 0 }, 'dealer')).toBe(10)
    expect(getPriceForRole({ price: 10 }, 'agent')).toBe(10)
  })

  it('handles string/numeric inputs and bad roles', () => {
    expect(getPriceForRole({ price: '10', agent_price: '9' } as any, 'agent')).toBe(9)
    expect(getPriceForRole(pkg, undefined as any)).toBe(10)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/pricing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/pricing.ts`**

```ts
import { RESELLER_TIERS, TIER_PRICE_FIELD, UserRole } from './roles'

export interface PackagePricing {
  price: number | string
  agent_price?: number | string | null
  super_agent_price?: number | string | null
  premium_agent_price?: number | string | null
  dealer_price?: number | string | null
  [key: string]: unknown
}

/**
 * Returns the price a given role pays for a package.
 * Reseller tiers pay their own column when it is > 0; everyone else (and any
 * tier with an unset/0 price) falls back to the base `price`.
 */
export function getPriceForRole(pkg: PackagePricing, role: UserRole | string | null | undefined): number {
  const base = Number(pkg.price) || 0
  if (role && (RESELLER_TIERS as string[]).includes(role)) {
    const field = TIER_PRICE_FIELD[role]
    const tierPrice = Number(pkg[field] ?? 0)
    if (tierPrice > 0) return tierPrice
  }
  return base
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/pricing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.ts lib/pricing.test.ts
git commit -m "feat(pricing): add getPriceForRole tier resolver"
```

---

## Task 4: Database migration — add price columns, role constraint, upgrade-price settings

**Files:**
- Create: `migrations/20260614_multi_tier_roles.sql`
- Modify: `types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration file `migrations/20260614_multi_tier_roles.sql`**

```sql
-- Multi-tier reseller roles & pricing (additive; agent_expires_at dropped in Task 9)

-- 1. Per-tier price columns (mirror agent_price)
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS super_agent_price numeric DEFAULT 0;
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS premium_agent_price numeric DEFAULT 0;
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS dealer_price numeric DEFAULT 0;

-- 2. Allow the new role slugs
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS user_role_check;
ALTER TABLE public.users ADD CONSTRAINT user_role_check CHECK (
  role = ANY (ARRAY['admin','sub-admin','agent','super-agent','premium-agent','dealer','customer','user'])
);

-- 3. One-time upgrade prices (seed defaults; admin edits later)
INSERT INTO public.admin_settings (key, value) VALUES
  ('upgrade_price_agent', '100'),
  ('upgrade_price_super_agent', '200'),
  ('upgrade_price_premium_agent', '300'),
  ('upgrade_price_dealer', '500')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Use the MCP tool `mcp__supabase__apply_migration` with `name: "multi_tier_roles"` and the SQL above.

Fallback (if MCP is not on project `jiuftcsomwnbnjikrbdp`) — run from `b:\LASTHOPE\LASTHOPE`:

```bash
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN)")
node -e "const fs=require('fs');const sql=fs.readFileSync('migrations/20260614_multi_tier_roles.sql','utf8');fetch('https://api.supabase.com/v1/projects/jiuftcsomwnbnjikrbdp/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:sql})}).then(r=>r.text()).then(t=>console.log(r=>r,t))"
```

- [ ] **Step 3: Verify the columns, constraint, and settings**

Run (Management API or `mcp__supabase__execute_sql`):

```sql
select
  (select count(*) from information_schema.columns where table_name='data_packages' and column_name in ('super_agent_price','premium_agent_price','dealer_price')) as price_cols,
  (select count(*) from admin_settings where key like 'upgrade_price_%') as upgrade_settings;
```
Expected: `price_cols = 3`, `upgrade_settings = 4`.

- [ ] **Step 4: Regenerate types**

Use `mcp__supabase__generate_typescript_types` and overwrite `types/database.types.ts`.

Fallback:

```bash
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('../.mcp.json','utf8')).mcpServers.supabase.env.SUPABASE_ACCESS_TOKEN)")
curl -s -H "Authorization: Bearer $TOKEN" "https://api.supabase.com/v1/projects/jiuftcsomwnbnjikrbdp/types/typescript" \
 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{require('fs').writeFileSync('types/database.types.ts',JSON.parse(d).types);console.log('types written')})"
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add migrations/20260614_multi_tier_roles.sql types/database.types.ts
git commit -m "feat(db): add tier price columns, role constraint, upgrade-price settings"
```

---

## Task 5: Route buying/charging through `getPriceForRole`

**Files:**
- Modify: `app/dashboard/data-packages/page.tsx` (price calc ~line 191; agent-only UI ~line 590)
- Modify: `app/api/orders/purchase/route.ts` (server charge — search `agent_price`)
- Modify: `app/api/guest/purchase/initialize/route.ts` (search `agent_price`)
- Modify: `app/dashboard/my-shop/page.tsx` (search `agent_price`)

- [ ] **Step 1: Replace the client price calc in `data-packages/page.tsx`**

Read the file around line 185-200. Replace the inline block:

```ts
// If user is agent AND agent_price is set (> 0), use agent_price
if (dbUser?.role === 'agent' && (pkg as any).agent_price > 0) {
    return (pkg as any).agent_price
}
return pkg.price
```

with a call to the shared resolver (add `import { getPriceForRole } from '@/lib/pricing'` at the top):

```ts
return getPriceForRole(pkg as any, dbUser?.role)
```

Also broaden the agent-only price-badge condition near line 590 from `dbUser?.role === 'agent'` to use the helper (add `import { isResellerRole } from '@/lib/roles'`):

```ts
{isResellerRole(dbUser?.role) && (
```

- [ ] **Step 2: Replace the server-authoritative charge in `app/api/orders/purchase/route.ts`**

Read the region that computes the order price (search `agent_price`). Add `import { getPriceForRole } from '@/lib/pricing'`. Replace the role/agent_price branching that picks the charge amount with:

```ts
const chargeAmount = getPriceForRole(pkg as any, dbUser?.role)
```

and use `chargeAmount` everywhere the code currently used the agent/base price for the wallet debit and the order's `price`. Keep all existing balance checks and the `debit_wallet` RPC call unchanged.

- [ ] **Step 3: Replace agent pricing in `app/api/guest/purchase/initialize/route.ts`**

Guests are not logged in, so they always pay base `price`. Read the file; if it special-cases `agent_price`, simplify to base `price` (guests have no reseller role). Add no import if `agent_price` is simply removed. Confirm the Paystack amount uses `price` (+ fee) only.

- [ ] **Step 4: Replace agent pricing in `app/dashboard/my-shop/page.tsx`**

Read the region using `agent_price`. The shop owner's own buying price is governed by their role; replace any `role === 'agent' ? agent_price : price` with `getPriceForRole(pkg, dbUser?.role)` (add the import). Leave the shop's *customer-facing* `custom_price` / `shop_packages` logic untouched.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Manual verification in the dev app**

With `npm run dev` running (port 3001): set the current admin user's role to `dealer` via SQL, set a package's `dealer_price` lower than `price` in admin, reload the buy page, and confirm the dealer price shows. Then place an order and confirm the wallet is debited the dealer price (check `wallet_transactions`). Reset role to `admin` after.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/data-packages/page.tsx app/api/orders/purchase/route.ts app/api/guest/purchase/initialize/route.ts app/dashboard/my-shop/page.tsx
git commit -m "feat(pricing): resolve buy/charge prices per reseller tier"
```

---

## Task 6: Convert the upgrade flow to permanent, multi-tier purchases

**Files:**
- Modify: `app/api/user/upgrade/initialize/route.ts`
- Modify: `lib/payments.ts` (upgrade detection ~line 43; `processCompletedUpgradePayment` ~line 175-280)

- [ ] **Step 1: Rewrite `app/api/user/upgrade/initialize/route.ts` to take a `tier`**

Replace the plan/price block (lines ~22 and ~70-130) so it:
- reads `{ tier }` from the body and validates `RESELLER_TIERS.includes(tier)` (import from `@/lib/roles`);
- allows the upgrade only when `dbUser.role === 'user' || isResellerRole(dbUser.role)` (and not admin/sub-admin);
- looks up `upgrade_price_<tier>` from `admin_settings` (key `'upgrade_price_' + tier.replace('-', '_')`);
- creates the pending `wallet_payments` row with `reference = 'upgrade_' + generateReferenceCode()` and `metadata = { user_id, target_role: tier }` (drop `plan_type` / `plan_days` / `plan_label`);
- sends Paystack `metadata: { user_id, target_role: tier }` and the same `callback_url`.

Key replacement for the price lookup:

```ts
const settingKey = 'upgrade_price_' + tier.replace(/-/g, '_')
const { data: settingRow } = await supabaseAdmin
  .from('admin_settings').select('value').eq('key', settingKey).single()
const upgradePrice = settingRow ? Number((settingRow as any).value) : 0
if (!upgradePrice || upgradePrice <= 0) {
  return NextResponse.json({ error: 'Upgrade price not configured for ' + tier }, { status: 400 })
}
```

And the eligibility check replacing the old `role !== 'user' && role !== 'agent'`:

```ts
import { RESELLER_TIERS, isResellerRole } from '@/lib/roles'
// ...
if (!RESELLER_TIERS.includes(tier)) {
  return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
}
if (dbUser?.role !== 'user' && !isResellerRole(dbUser?.role)) {
  return NextResponse.json({ error: 'Upgrades are only available to customers and existing reseller tiers.' }, { status: 400 })
}
```

- [ ] **Step 2: Update upgrade detection in `lib/payments.ts`**

Replace line ~43:

```ts
const isUpgrade = payment.metadata?.upgrade_type === 'agent' || reference.startsWith('agent_upgrade_')
```

with:

```ts
const isUpgrade = !!payment.metadata?.target_role || reference.startsWith('upgrade_') || reference.startsWith('agent_upgrade_')
```

- [ ] **Step 3: Make `processCompletedUpgradePayment` set the role permanently**

In `lib/payments.ts` (~line 245-280), change the user fetch `.select('role, agent_expires_at, ...')` to `.select('role, email, first_name, phone_number')` (drop `agent_expires_at`), delete the `planDays` / `currentExpiry` / `newExpiry` block (~lines 257-272), and change the update to:

```ts
const targetRole = (payment.metadata as any)?.target_role || 'agent'
// ...
.update({
    role: targetRole,
    status: 'active',
    updated_at: new Date().toISOString(),
})
.eq('id', payment.user_id)
```

Remove any `agent_expires_at` from this update.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/user/upgrade/initialize/route.ts lib/payments.ts
git commit -m "feat(upgrade): permanent multi-tier upgrades keyed on target_role"
```

---

## Task 7: Upgrade page — tier selection cards

**Files:**
- Modify: `app/dashboard/upgrade/page.tsx`

- [ ] **Step 1: Replace plan selection with tier cards**

Read the page. Replace the 3/14/30-day plan UI and its `plan` state with a tier list driven by `RESELLER_TIERS` (import from `@/lib/roles`) and `roleConfig` for labels. Fetch the four `upgrade_price_*` settings (reuse `/api/admin/get-prices` after Task 8, or fetch `admin_settings` directly with the anon client). On select, POST `{ tier }` to `/api/user/upgrade/initialize` and redirect to `authorization_url`.

Minimal card list shape:

```tsx
import { RESELLER_TIERS, roleConfig, UserRole } from '@/lib/roles'
// prices: Record<UserRole, number> fetched from settings
{RESELLER_TIERS.map((tier) => (
  <button key={tier} onClick={() => startUpgrade(tier)} className="...">
    <span>{roleConfig[tier].label}</span>
    <span>GHS {prices[tier] ?? '--'}</span>
  </button>
))}
```

```ts
async function startUpgrade(tier: UserRole) {
  const res = await fetch('/api/user/upgrade/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  })
  const data = await res.json()
  if (data.authorization_url) window.location.href = data.authorization_url
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual verification**

Load `/dashboard/upgrade` in the dev app; confirm 4 tier cards render with prices. (Do not complete a real Paystack payment — test keys are placeholders.)

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/upgrade/page.tsx
git commit -m "feat(upgrade): tier-selection cards on the upgrade page"
```

---

## Task 8: Admin config — package tier prices, upgrade prices, role assignment

**Files:**
- Modify: `app/admin/packages/page.tsx` (PackageFormData ~line 48; defaults ~line 59; inputs ~line 380-410)
- Modify: `app/api/admin/get-prices/route.ts`
- Modify: `app/api/admin/update-prices/route.ts`
- Modify: `app/api/admin/users/role/route.ts`
- Modify: `app/admin/users/page.tsx` (role dropdown)

- [ ] **Step 1: Add tier price inputs to the packages form**

In `app/admin/packages/page.tsx`: add `super_agent_price`, `premium_agent_price`, `dealer_price` to the `PackageFormData` interface (line ~48), to `defaultFormData` (line ~59, default `0`), and add three numeric inputs mirroring the existing `agent_price` input (around line 390). The submit body already spreads `formData`, so the package create/update API persists them (verify the packages POST/PUT route inserts these columns; add them if it lists columns explicitly).

- [ ] **Step 2: Rewrite `get-prices` for the four one-time tier prices**

Replace `app/api/admin/get-prices/route.ts` body with:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { RESELLER_TIERS } from '@/lib/roles'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const keys = RESELLER_TIERS.map(t => 'upgrade_price_' + t.replace(/-/g, '_'))
    const { data, error } = await supabase.from('admin_settings').select('key, value').in('key', keys)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const prices: Record<string, number> = {}
    for (const t of RESELLER_TIERS) {
      const key = 'upgrade_price_' + t.replace(/-/g, '_')
      prices[t] = parseFloat(data?.find(s => s.key === key)?.value || '0')
    }
    return NextResponse.json({ prices })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Rewrite `update-prices` for the four tier prices**

Replace `app/api/admin/update-prices/route.ts` body with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { RESELLER_TIERS } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const supabaseAdmin = auth.supabase

    const { prices } = await request.json()
    if (!prices) return NextResponse.json({ error: 'Prices are required' }, { status: 400 })

    for (const t of RESELLER_TIERS) {
      if (prices[t] === undefined) continue
      const key = 'upgrade_price_' + t.replace(/-/g, '_')
      await supabaseAdmin.from('admin_settings').delete().eq('key', key)
      const { error } = await supabaseAdmin.from('admin_settings').insert({ key, value: String(prices[t]) } as any)
      if (error) return NextResponse.json({ error: `Failed to update ${key}: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
```

Update the admin settings UI (`app/admin/settings/page.tsx` and/or `app/admin/memberships/page.tsx`) that reads/writes these prices to send a `prices` object keyed by tier slug instead of `{ '3d','14d','30d' }`. Read those files and adjust the form fields to one input per tier.

- [ ] **Step 4: Generalize the admin role-assignment route**

Replace `app/api/admin/users/role/route.ts` so it validates the role against the allowed set and drops all `agent_expires_at` logic and the agent SMS block:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

const ALLOWED_ROLES = ['admin', 'sub-admin', 'agent', 'super-agent', 'premium-agent', 'dealer', 'user']

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const supabase = auth.supabase

    const { userId, role } = await request.json()
    if (!userId || !role) return NextResponse.json({ error: 'userId and role are required' }, { status: 400 })
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    const { error } = await (supabase.from('users') as any)
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw error

    return NextResponse.json({ success: true, userId, newRole: role })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 5: Add the new roles to the admin user dropdown**

In `app/admin/users/page.tsx`, find the role `<Select>`/options list and add `super-agent`, `premium-agent`, `dealer` (use `roleConfig[role].label` for display; import from `@/lib/roles`). If the page renders a fixed array of roles, replace it with the keys of `roleConfig` excluding `customer`.

- [ ] **Step 6: Typecheck + manual verification**

Run: `npx tsc --noEmit` (expect exit 0). In the dev app: open admin → packages, set the three new prices on a package and save; open admin → users, assign `super-agent` to a test user and confirm it persists.

- [ ] **Step 7: Commit**

```bash
git add app/admin/packages/page.tsx app/api/admin/get-prices/route.ts app/api/admin/update-prices/route.ts app/api/admin/users/role/route.ts app/admin/users/page.tsx app/admin/settings/page.tsx app/admin/memberships/page.tsx
git commit -m "feat(admin): tier package prices, one-time upgrade prices, role assignment"
```

---

## Task 9: Retire the expiry / plans / downgrade machinery

**Files:**
- Delete: `app/api/agent/downgrade/route.ts`, `app/api/cron/agent-renewal-reminder/route.ts`, `app/api/admin/extend-agent/route.ts`, `components/agent-expiry-modal.tsx`
- Modify: `contexts/auth-context.tsx`, `app/dashboard/profile/page.tsx`, `app/admin/memberships/page.tsx`, and any importer of the deleted files
- Migration: drop `users.agent_expires_at`

- [ ] **Step 1: Find every reference**

Run:

```bash
grep -rn -E "agent_expires_at|agent-expiry-modal|agent/downgrade|agent-renewal-reminder|extend-agent|AgentExpiry" --include="*.ts" --include="*.tsx" app components contexts lib
```
Note every file in the output.

- [ ] **Step 2: Remove auto-downgrade in `contexts/auth-context.tsx`**

Read the file and delete the block that checks `agent_expires_at` and POSTs to `/api/agent/downgrade` (and any timer/effect that drives it). Leave the rest of the session/user-fetch logic intact.

- [ ] **Step 3: Remove the expiry modal usage**

In any file importing `agent-expiry-modal` (e.g. a dashboard layout/page from Step 1 output), remove the import and the `<AgentExpiryModal .../>` usage. Then delete `components/agent-expiry-modal.tsx`.

- [ ] **Step 4: Remove `agent_expires_at` reads in `profile` and `memberships`**

In `app/dashboard/profile/page.tsx` and `app/admin/memberships/page.tsx`, remove any display of `agent_expires_at`/expiry. For `memberships`, render members grouped by reseller role (use `isResellerRole`); no expiry column.

- [ ] **Step 5: Delete the now-unused routes**

```bash
git rm app/api/agent/downgrade/route.ts app/api/cron/agent-renewal-reminder/route.ts app/api/admin/extend-agent/route.ts
```

- [ ] **Step 6: Verify no references remain**

Run the Step 1 grep again.
Expected: no matches (outside generated `tsconfig.tsbuildinfo`).

- [ ] **Step 7: Drop the column (migration)**

Create `migrations/20260614_drop_agent_expires_at.sql`:

```sql
ALTER TABLE public.users DROP COLUMN IF EXISTS agent_expires_at;
```

Apply via `mcp__supabase__apply_migration` (name `drop_agent_expires_at`) or the Task 4 fallback. Then regenerate `types/database.types.ts` (Task 4 Step 4).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: retire agent expiry/plans/downgrade (permanent tiers)"
```

---

## Task 10: Broaden storefront/role gates and clean stale settings

**Files:**
- Modify: `components/dashboard/sidebar.tsx`, `app/dashboard/layout.tsx`, `app/dashboard/page.tsx`, `app/dashboard/my-shop/page.tsx` (and any other `role === 'agent'` gate from the grep below)

- [ ] **Step 1: Find agent-only gates**

Run:

```bash
grep -rn "=== 'agent'" --include="*.ts" --include="*.tsx" app components contexts
```

- [ ] **Step 2: Replace storefront/perk gates with `isResellerRole`**

For each gate that controls a *reseller perk* (My Shop link, shop creation, agent-only nav, "you are an agent" banners), replace `role === 'agent'` with `isResellerRole(role)` (import from `@/lib/roles`). Do **not** change checks that are specifically about the literal agent tier for display-only copy where a generic label is wrong — prefer `roleConfig[role].label` there.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Manual verification**

In the dev app, set a test user to `dealer`; confirm the My Shop nav/storefront features appear for them.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(perks): unlock storefront for all reseller tiers"
```

---

## Task 11: Final end-to-end verification

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: all pass (roles, pricing, smoke).

- [ ] **Step 2: Typecheck the whole app**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build completes (no type/route errors).

- [ ] **Step 4: Manual per-tier price check**

For each role in `agent`, `super-agent`, `premium-agent`, `dealer`: set the current user's role via SQL, set a distinct tier price on one package in admin, reload the buy page, and confirm the correct price displays and is charged on purchase. Reset the user to `admin` afterward.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: multi-tier reseller roles end-to-end verification"
```

---

## Self-review notes

- **Spec coverage:** roles (T2), columns + constraint + settings (T4), exact per-tier pricing + resolver (T3, T5, T8), one-time permanent upgrades (T6, T7), retire expiry/plans/downgrade + drop column (T9), admin assign + storefront-for-all (T8, T10). All spec sections map to a task.
- **Order safety:** all `agent_expires_at` code references are removed (T9 Steps 1-6) *before* the column is dropped (T9 Step 7).
- **Charge safety:** client and server both call `getPriceForRole` (T5 Steps 1-2).
- **Type consistency:** `RESELLER_TIERS`, `isResellerRole`, `TIER_PRICE_FIELD`, `getPriceForRole`, and `metadata.target_role` are used with the same names across T2/T3/T6/T8.
