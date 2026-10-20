-- Applied to the live project on 2026-10-20 (migration: create_admin_notes).
-- Private notes admins leave on a user account (support context, warnings, follow-ups).
CREATE TABLE IF NOT EXISTS public.admin_notes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    author_id    uuid,
    author_email text,
    body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_notes_user_idx ON public.admin_notes (user_id, created_at DESC);

-- Server-only: RLS on, no policies.
ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notes FROM anon, authenticated;
