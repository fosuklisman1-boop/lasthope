-- Multi-tier reseller roles & pricing (additive; agent_expires_at dropped in Task 9)

-- 1. Per-tier price columns (mirror agent_price)
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS super_agent_price numeric DEFAULT 0;
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS premium_agent_price numeric DEFAULT 0;
ALTER TABLE public.data_packages ADD COLUMN IF NOT EXISTS dealer_price numeric DEFAULT 0;

-- 2. Allow the new role slugs
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS user_role_check;
ALTER TABLE public.users ADD CONSTRAINT user_role_check CHECK (
  role = ANY (ARRAY['admin','sub-admin','agent','super-agent','premium-agent','dealer','customer','user'])
);

-- 3. One-time upgrade prices (seed defaults; admin edits later)
INSERT INTO public.admin_settings (key, value) VALUES
  ('upgrade_price_agent', '100'),
  ('upgrade_price_super_agent', '200'),
  ('upgrade_price_premium_agent', '300'),
  ('upgrade_price_dealer', '500')
ON CONFLICT (key) DO NOTHING;
