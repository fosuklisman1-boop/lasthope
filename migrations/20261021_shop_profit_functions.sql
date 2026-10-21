-- Applied to the live project on 2026-10-21 (migration: shop_profit_functions).
-- Profit totals computed in the database (a row fetch stops at 1000 rows). Server-only.

-- One shop: profit on live paid orders and the sum of the ledger.
CREATE OR REPLACE FUNCTION public.shop_profit_parts(p_shop_id uuid)
RETURNS TABLE (order_profit numeric, ledger numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        COALESCE((SELECT sum(profit_amount) FROM public.orders WHERE shop_id = p_shop_id AND payment_status = 'paid'), 0),
        COALESCE((SELECT sum(amount) FROM public.shop_adjustments WHERE shop_id = p_shop_id), 0);
$$;

-- All shops, for the admin list.
CREATE OR REPLACE FUNCTION public.admin_shop_summary()
RETURNS TABLE (
    shop_id uuid, order_profit numeric, ledger numeric,
    paid_orders bigint, sales numeric, last_sale timestamptz,
    withdrawn numeric, pending numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT s.id,
           COALESCE(o.profit, 0), COALESCE(l.total, 0),
           COALESCE(o.n, 0), COALESCE(o.sales, 0), o.last_sale,
           COALESCE(w.approved, 0), COALESCE(w.pending, 0)
    FROM public.shops s
    LEFT JOIN (
        SELECT shop_id, sum(profit_amount) AS profit, count(*) AS n, sum(price) AS sales, max(created_at) AS last_sale
        FROM public.orders WHERE payment_status = 'paid' AND shop_id IS NOT NULL GROUP BY shop_id
    ) o ON o.shop_id = s.id
    LEFT JOIN (SELECT shop_id, sum(amount) AS total FROM public.shop_adjustments GROUP BY shop_id) l ON l.shop_id = s.id
    LEFT JOIN (
        SELECT user_id,
               sum(amount) FILTER (WHERE status = 'approved') AS approved,
               sum(amount) FILTER (WHERE status = 'pending') AS pending
        FROM public.withdrawals GROUP BY user_id
    ) w ON w.user_id = s.user_id;
$$;

REVOKE EXECUTE ON FUNCTION public.shop_profit_parts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_shop_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_profit_parts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_shop_summary() TO service_role;
