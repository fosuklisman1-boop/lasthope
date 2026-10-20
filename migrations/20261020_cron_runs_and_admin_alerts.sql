-- Applied to the live project on 2026-10-20 (migration: cron_runs_and_admin_alerts).
-- Last-run record for each scheduled job (written by the job itself).
CREATE TABLE IF NOT EXISTS public.cron_runs (
    job              text PRIMARY KEY,
    last_started_at  timestamptz,
    last_finished_at timestamptz,
    last_status      text CHECK (last_status IN ('ok', 'error')),
    last_error       text,
    last_duration_ms integer,
    last_result      jsonb,
    runs_total       bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_runs FROM anon, authenticated;

-- Operational alerts for admins. One open alert per dedupe_key.
CREATE TABLE IF NOT EXISTS public.admin_alerts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         text NOT NULL,
    severity     text NOT NULL CHECK (severity IN ('high', 'medium')),
    title        text NOT NULL,
    body         text NOT NULL,
    dedupe_key   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    notified_at  timestamptz,
    resolved_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_open_dedupe_uniq
    ON public.admin_alerts (dedupe_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_alerts_created_idx ON public.admin_alerts (created_at DESC);
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_alerts FROM anon, authenticated;
