-- Applied to the live project on 2026-10-20 (migration: admin_mfa_enrolled_function).
-- Which users have a verified TOTP authenticator? Lets the admin Security page show who has
-- enrolled before two-factor is enforced. auth.mfa_factors is not exposed over the API,
-- so this is a server-only SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.admin_mfa_enrolled()
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT DISTINCT f.user_id
    FROM auth.mfa_factors f
    WHERE f.status = 'verified' AND f.factor_type = 'totp';
$$;

REVOKE EXECUTE ON FUNCTION public.admin_mfa_enrolled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mfa_enrolled() TO service_role;
