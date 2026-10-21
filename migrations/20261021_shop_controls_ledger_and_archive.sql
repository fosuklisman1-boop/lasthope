-- Applied to the live project on 2026-10-21 (migration: shop_controls_ledger_and_archive).
-- Admin controls over reseller shops. All server-only (RLS on, no policies).

-- Per-shop admin state, kept apart from public.shops because owners can edit their own shop row.
CREATE TABLE IF NOT EXISTS public.shop_controls (
    shop_id            uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
    suspended          boolean NOT NULL DEFAULT false,
    suspended_reason   text,
    suspended_message  text,
    suspended_at       timestamptz,
    suspended_by       uuid,
    withdrawals_held   boolean NOT NULL DEFAULT false,
    hold_reason        text,
    max_margin_percent numeric(6,2) CHECK (max_margin_percent IS NULL OR (max_margin_percent >= 0 AND max_margin_percent <= 1000)),
    min_withdrawal     numeric(12,2) CHECK (min_withdrawal IS NULL OR min_withdrawal > 0),
    profile_locked     boolean NOT NULL DEFAULT false,
    notes              text,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Packages an admin has switched off for one shop (the owner cannot switch them back on).
CREATE TABLE IF NOT EXISTS public.shop_blocked_packages (
    shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    package_id uuid NOT NULL REFERENCES public.data_packages(id) ON DELETE CASCADE,
    reason     text,
    blocked_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (shop_id, package_id)
);

-- Profit ledger. A shop's profit = profit on its live orders + the sum of this ledger.
--  adjustment     an admin added or took away profit
--  order_reversal an admin cancelled the profit of one order (negative)
--  archived       profit moved here when old orders were deleted (positive)
CREATE TABLE IF NOT EXISTS public.shop_adjustments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id    uuid NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    kind       text NOT NULL CHECK (kind IN ('adjustment', 'order_reversal', 'archived')),
    amount     numeric(12,2) NOT NULL CHECK (amount <> 0),
    reason     text NOT NULL CHECK (char_length(btrim(reason)) >= 5),
    order_id   uuid,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_adjustments_shop_idx ON public.shop_adjustments (shop_id, created_at DESC);
-- An order's profit can be cancelled only once. (No foreign key: orders are deleted after 14 days.)
CREATE UNIQUE INDEX IF NOT EXISTS shop_adjustments_one_reversal_per_order
    ON public.shop_adjustments (order_id) WHERE kind = 'order_reversal';

-- The ledger is append-only. A mistake is corrected with another entry.
CREATE OR REPLACE FUNCTION public.shop_adjustments_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'shop_adjustments is append-only';
END;
$$;
DROP TRIGGER IF EXISTS shop_adjustments_no_change ON public.shop_adjustments;
CREATE TRIGGER shop_adjustments_no_change
    BEFORE UPDATE OR DELETE ON public.shop_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.shop_adjustments_immutable();

-- Cleanup that no longer erases shop profit. Deletes orders older than the cutoff and, in the same
-- statement, moves the paid profit of shop orders into the ledger.
CREATE OR REPLACE FUNCTION public.archive_old_orders(p_cutoff timestamptz)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH del AS (
        DELETE FROM public.orders WHERE created_at < p_cutoff
        RETURNING id, shop_id, profit_amount, payment_status
    ),
    agg AS (
        SELECT shop_id, sum(profit_amount) AS amt, count(*) AS n
        FROM del
        WHERE shop_id IS NOT NULL AND payment_status = 'paid' AND coalesce(profit_amount, 0) <> 0
        GROUP BY shop_id
        HAVING sum(profit_amount) <> 0
    ),
    ins AS (
        INSERT INTO public.shop_adjustments (shop_id, kind, amount, reason, created_by)
        SELECT shop_id, 'archived', round(amt, 2), 'Profit from ' || n || ' order(s) older than the retention period', NULL
        FROM agg
        RETURNING 1
    )
    SELECT count(*)::bigint FROM del;
$$;

ALTER TABLE public.shop_controls         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_blocked_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_adjustments      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_controls, public.shop_blocked_packages, public.shop_adjustments FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shop_adjustments_immutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_old_orders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_orders(timestamptz) TO service_role;

-- Owners may no longer write shop rows straight through the public API: suspensions, margin caps and
-- blocked packages would otherwise be undoable. The app writes through its own server routes.
REVOKE INSERT, UPDATE, DELETE ON public.shops, public.shop_packages FROM anon, authenticated;
