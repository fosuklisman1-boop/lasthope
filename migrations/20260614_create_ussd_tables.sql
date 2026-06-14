-- USSD Shop Storefront: schema additions
-- See docs/superpowers/specs/2026-06-14-ussd-shop-storefront-design.md

-- 1. Per-shop USSD configuration + prepaid session credits
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS ussd_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS ussd_code TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS ussd_callback_token TEXT UNIQUE;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS ussd_credits INTEGER NOT NULL DEFAULT 0;

-- 2. Orders: channel tag (web vs ussd) + payment_metadata.
-- payment_metadata also fixes a pre-existing bug: processCompletedShopOrder
-- (lib/payments.ts) writes order.payment_metadata, but the column never
-- existed, so GST- shop-order completion has been silently failing.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'ussd'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_metadata JSONB DEFAULT '{}'::jsonb;

-- 3. USSD session state machine (short-lived rows, swept by a cleanup cron)
CREATE TABLE IF NOT EXISTS public.ussd_sessions (
    session_id TEXT PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    msisdn TEXT NOT NULL,
    step TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ussd_sessions_shop_id ON public.ussd_sessions(shop_id);
CREATE INDEX IF NOT EXISTS idx_ussd_sessions_created_at ON public.ussd_sessions(created_at);

-- Only the service-role client (callback route, cleanup cron) ever touches
-- this table. Enabling RLS with no policies denies anon/authenticated access
-- by default while leaving the service-role client (which bypasses RLS)
-- unaffected.
ALTER TABLE public.ussd_sessions ENABLE ROW LEVEL SECURITY;

-- 4. USSD session-credit purchases (mirrors wallet_payments)
CREATE TABLE IF NOT EXISTS public.ussd_credit_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    sessions INTEGER NOT NULL CHECK (sessions > 0),
    amount DECIMAL(12,2) NOT NULL,
    reference TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ussd_credit_purchases_shop_id ON public.ussd_credit_purchases(shop_id);

ALTER TABLE public.ussd_credit_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shop owners view own ussd credit purchases" ON public.ussd_credit_purchases;
CREATE POLICY "Shop owners view own ussd credit purchases" ON public.ussd_credit_purchases
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.shops
            WHERE shops.id = ussd_credit_purchases.shop_id
            AND shops.user_id = auth.uid()
        )
    );

-- 5. Atomic credit decrement (mirrors credit_wallet RPC) — used by the USSD
-- callback route on every new dial-in.
CREATE OR REPLACE FUNCTION public.decrement_ussd_credits(p_shop_id UUID)
RETURNS TABLE(ussd_credits INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.shops
    SET ussd_credits = shops.ussd_credits - 1
    WHERE shops.id = p_shop_id AND shops.ussd_credits > 0
    RETURNING shops.ussd_credits;
END;
$$;

-- 6. Atomic credit increment — used when a USSD credit top-up completes.
-- Atomic so it can't race with decrement_ussd_credits on a concurrent
-- customer dial-in (read-then-write would lose updates here).
CREATE OR REPLACE FUNCTION public.increment_ussd_credits(p_shop_id UUID, p_sessions INTEGER)
RETURNS TABLE(ussd_credits INTEGER, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.shops
    SET ussd_credits = shops.ussd_credits + p_sessions
    WHERE shops.id = p_shop_id
    RETURNING shops.ussd_credits, shops.user_id;
END;
$$;
