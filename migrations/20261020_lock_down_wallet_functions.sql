-- Applied to the live project on 2026-10-20 (migration: lock_down_wallet_and_helper_functions).
-- Wallet-moving and helper functions must only be callable by the server (service role).
-- The anon key ships in every client bundle, so leaving EXECUTE open to anon/authenticated
-- let anyone call /rest/v1/rpc/credit_wallet and mint balance.
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_wallet(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_wallet(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- Pin the search_path of the signup trigger function.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
