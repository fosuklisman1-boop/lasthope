-- Applied to the live project on 2026-10-20 (migration: api_key_usage_daily).
-- Per-key, per-day counters for the Developer API. Written by the server only.
CREATE TABLE IF NOT EXISTS public.api_key_usage_daily (
    api_key_id   uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
    day          date NOT NULL,
    requests     integer NOT NULL DEFAULT 0,
    errors       integer NOT NULL DEFAULT 0,
    rate_limited integer NOT NULL DEFAULT 0,
    PRIMARY KEY (api_key_id, day)
);

ALTER TABLE public.api_key_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_key_usage_daily FROM anon, authenticated;

-- Atomic increment (one row per key per UTC day).
CREATE OR REPLACE FUNCTION public.bump_api_key_usage(p_key uuid, p_requests integer, p_errors integer, p_limited integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    INSERT INTO public.api_key_usage_daily AS u (api_key_id, day, requests, errors, rate_limited)
    VALUES (p_key, (now() AT TIME ZONE 'utc')::date, p_requests, p_errors, p_limited)
    ON CONFLICT (api_key_id, day) DO UPDATE
    SET requests     = u.requests + EXCLUDED.requests,
        errors       = u.errors + EXCLUDED.errors,
        rate_limited = u.rate_limited + EXCLUDED.rate_limited;
$$;

REVOKE EXECUTE ON FUNCTION public.bump_api_key_usage(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_api_key_usage(uuid, integer, integer, integer) TO service_role;
