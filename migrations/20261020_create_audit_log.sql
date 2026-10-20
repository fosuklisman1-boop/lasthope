-- Applied to the live project on 2026-10-20 (migration: create_audit_log).
-- Append-only record of administrative actions. Written by the server (service role) only.
CREATE TABLE IF NOT EXISTS public.audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    actor_id    uuid,
    actor_email text,
    actor_role  text,
    action      text NOT NULL,
    target_type text,
    target_id   text,
    summary     text NOT NULL,
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason      text,
    ip          text
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON public.audit_log (target_type, target_id, created_at DESC);

-- Same pattern as api_keys: RLS on, no policies => reachable only with the service role.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Rows are never edited or removed through normal operation.
CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

REVOKE ALL ON public.audit_log FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_immutable() FROM PUBLIC, anon, authenticated;
