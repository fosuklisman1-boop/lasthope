-- Applied to the live project on 2026-10-21 (migration: roles_and_price_tables).
-- Custom roles, price tables and per-customer prices. All server-only (RLS on, no policies).

-- ── Price tables ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.price_tables (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS price_tables_name_uniq ON public.price_tables (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.price_table_items (
    price_table_id uuid NOT NULL REFERENCES public.price_tables(id) ON DELETE CASCADE,
    package_id     uuid NOT NULL REFERENCES public.data_packages(id) ON DELETE CASCADE,
    price          numeric(12,2) NOT NULL CHECK (price > 0),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (price_table_id, package_id)
);
CREATE INDEX IF NOT EXISTS price_table_items_package_idx ON public.price_table_items (package_id);

-- ── Roles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
    slug           text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9-]{1,38}$'),
    label          text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
    kind           text NOT NULL DEFAULT 'custom' CHECK (kind IN ('system', 'custom')),
    is_reseller    boolean NOT NULL DEFAULT false,
    color          text NOT NULL DEFAULT '#0EA5E9' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    icon           text NOT NULL DEFAULT 'BadgeCheck',
    rank           integer NOT NULL DEFAULT 100,
    price_table_id uuid REFERENCES public.price_tables(id) ON DELETE SET NULL,
    upgrade_price  numeric(12,2) CHECK (upgrade_price IS NULL OR upgrade_price > 0),
    upgradable     boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_upgradable_needs_price CHECK (NOT upgradable OR upgrade_price IS NOT NULL)
);

-- The seven built-in roles (not purchasable until their upgrade price is copied in below).
INSERT INTO public.roles (slug, label, kind, is_reseller, color, icon, rank) VALUES
    ('admin',         'Admin',         'system', false, '#E60000', 'Crown',      1),
    ('sub-admin',     'Sub-Admin',     'system', false, '#FACC15', 'Star',       2),
    ('dealer',        'Dealer',        'system', true,  '#7C3AED', 'Briefcase',  3),
    ('premium-agent', 'Premium Agent', 'system', true,  '#0EA5E9', 'Gem',        4),
    ('super-agent',   'Super Agent',   'system', true,  '#F59E0B', 'Award',      5),
    ('agent',         'Agent',         'system', true,  '#25D366', 'BadgeCheck', 6),
    ('user',          'Customer',      'system', false, '#0056B3', 'UserCircle', 7)
ON CONFLICT (slug) DO NOTHING;

-- Copy each reseller tier's current upgrade price (only valid positive numbers) and
-- keep those tiers purchasable, exactly as the Upgrade page offers them today.
UPDATE public.roles r
SET upgrade_price = s.value::numeric,
    upgradable = true
FROM public.admin_settings s
WHERE s.key = 'upgrade_price_' || replace(r.slug, '-', '_')
  AND s.value ~ '^[0-9]+(\.[0-9]+)?$'
  AND s.value::numeric > 0
  AND r.is_reseller;

-- Built-in roles keep their slug and cannot be removed.
CREATE OR REPLACE FUNCTION public.roles_protect_system()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.kind = 'system' THEN
            RAISE EXCEPTION 'The built-in role "%" cannot be deleted', OLD.slug;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.kind = 'system' AND (NEW.slug <> OLD.slug OR NEW.kind <> OLD.kind) THEN
        RAISE EXCEPTION 'The built-in role "%" cannot be renamed or changed', OLD.slug;
    END IF;
    IF OLD.kind = 'custom' AND NEW.slug <> OLD.slug THEN
        RAISE EXCEPTION 'A role''s slug cannot be changed after it is created';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS roles_protect_system_trg ON public.roles;
CREATE TRIGGER roles_protect_system_trg
    BEFORE UPDATE OR DELETE ON public.roles
    FOR EACH ROW EXECUTE FUNCTION public.roles_protect_system();

-- users.role now points at the roles table instead of a fixed list.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS user_role_check;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_fkey;
ALTER TABLE public.users ADD CONSTRAINT users_role_fkey
    FOREIGN KEY (role) REFERENCES public.roles(slug) ON UPDATE CASCADE ON DELETE RESTRICT;

-- ── Per-customer prices ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_prices (
    user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    package_id uuid NOT NULL REFERENCES public.data_packages(id) ON DELETE CASCADE,
    price      numeric(12,2) NOT NULL CHECK (price > 0),
    set_by     uuid,
    reason     text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, package_id)
);
CREATE INDEX IF NOT EXISTS customer_prices_package_idx ON public.customer_prices (package_id);

-- ── Lock everything to the server (service role), like api_keys ──────────
ALTER TABLE public.price_tables      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_table_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_prices   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_tables, public.price_table_items, public.roles, public.customer_prices FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.roles_protect_system() FROM PUBLIC, anon, authenticated;
