-- Applied to the live project on 2026-10-20 (migration: admin_report_functions).
-- Aggregations for the admin Reports and Reseller pages. Run in the database so the
-- pages never pull whole tables. Server-only (service role).

CREATE OR REPLACE FUNCTION public.admin_report(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH o AS (
    SELECT ord.created_at, ord.status, ord.price, ord.cost_price, ord.network, ord.size,
           COALESCE(u.role, 'guest') AS tier
    FROM public.orders ord
    LEFT JOIN public.users u ON u.id = ord.user_id
    WHERE ord.created_at >= p_from AND ord.created_at < p_to
)
SELECT jsonb_build_object(
    'totals', (
        SELECT jsonb_build_object(
            'orders',    count(*),
            'completed', count(*) FILTER (WHERE status = 'completed'),
            'failed',    count(*) FILTER (WHERE status = 'failed'),
            'revenue',   COALESCE(sum(price) FILTER (WHERE status = 'completed'), 0),
            'cost',      COALESCE(sum(cost_price) FILTER (WHERE status = 'completed'), 0)
        ) FROM o
    ),
    'by_day', (
        SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.day), '[]'::jsonb) FROM (
            SELECT (created_at AT TIME ZONE 'utc')::date AS day,
                   count(*) FILTER (WHERE status = 'completed') AS orders,
                   COALESCE(sum(price) FILTER (WHERE status = 'completed'), 0) AS revenue,
                   COALESCE(sum(price - cost_price) FILTER (WHERE status = 'completed'), 0) AS profit
            FROM o GROUP BY 1
        ) d
    ),
    'by_network', (
        SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.revenue DESC), '[]'::jsonb) FROM (
            SELECT COALESCE(network, 'Unknown') AS network,
                   count(*) FILTER (WHERE status = 'completed') AS orders,
                   COALESCE(sum(price) FILTER (WHERE status = 'completed'), 0) AS revenue,
                   COALESCE(sum(price - cost_price) FILTER (WHERE status = 'completed'), 0) AS profit
            FROM o GROUP BY 1
        ) n
    ),
    'by_tier', (
        SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.revenue DESC), '[]'::jsonb) FROM (
            SELECT tier,
                   count(*) FILTER (WHERE status = 'completed') AS orders,
                   COALESCE(sum(price) FILTER (WHERE status = 'completed'), 0) AS revenue,
                   COALESCE(sum(price - cost_price) FILTER (WHERE status = 'completed'), 0) AS profit
            FROM o GROUP BY 1
        ) t
    ),
    'top_packages', (
        SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.revenue DESC), '[]'::jsonb) FROM (
            SELECT COALESCE(network, 'Unknown') AS network, COALESCE(size, '') AS size,
                   count(*) AS orders,
                   COALESCE(sum(price), 0) AS revenue
            FROM o WHERE status = 'completed'
            GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 10
        ) p
    )
);
$$;

-- Reseller activity: current period vs the one before it, per reseller.
CREATE OR REPLACE FUNCTION public.admin_reseller_activity(p_days integer)
RETURNS TABLE (
    user_id uuid, email text, first_name text, last_name text, role text, joined_at timestamptz,
    orders_cur bigint, revenue_cur numeric, orders_prev bigint, revenue_prev numeric, last_order_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at,
           count(o.id) FILTER (WHERE o.status = 'completed' AND o.created_at >= now() - make_interval(days => p_days)),
           COALESCE(sum(o.price) FILTER (WHERE o.status = 'completed' AND o.created_at >= now() - make_interval(days => p_days)), 0),
           count(o.id) FILTER (WHERE o.status = 'completed' AND o.created_at <  now() - make_interval(days => p_days)
                                                              AND o.created_at >= now() - make_interval(days => 2 * p_days)),
           COALESCE(sum(o.price) FILTER (WHERE o.status = 'completed' AND o.created_at <  now() - make_interval(days => p_days)
                                                                       AND o.created_at >= now() - make_interval(days => 2 * p_days)), 0),
           max(o.created_at) FILTER (WHERE o.status = 'completed')
    FROM public.users u
    LEFT JOIN public.orders o ON o.user_id = u.id AND o.created_at >= now() - make_interval(days => 2 * p_days)
    WHERE u.role IN ('agent', 'super-agent', 'premium-agent', 'dealer')
    GROUP BY u.id;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_report(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reseller_activity(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_report(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_reseller_activity(integer) TO service_role;
