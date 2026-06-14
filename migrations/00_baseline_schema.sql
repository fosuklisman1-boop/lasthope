-- =============================================================================
-- BASELINE SCHEMA  (reconstructed from the source project's live Postgres catalog)
-- Apply this FIRST to a fresh Supabase project, then the timestamped migrations.
-- Covers the base tables that were originally created via the dashboard and were
-- never recorded as migrations.
--
-- NOTE: This client baseline intentionally EXCLUDES the USSD feature
-- (ussd_sessions / ussd_credit_purchases tables, shops.ussd_* columns,
-- orders.channel, and the increment/decrement_ussd_credits functions).
-- orders.payment_metadata is kept because lib/payments.ts depends on it.
-- =============================================================================

-- ---- Extensions -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- Tables -----------------------------------------------------------------
CREATE TABLE public.admin_settings (
  key text NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.complaints (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  order_id uuid,
  subject text,
  description text,
  status text DEFAULT 'pending'::text,
  admin_response text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.data_packages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  network text NOT NULL,
  size text NOT NULL,
  price numeric NOT NULL,
  agent_price numeric DEFAULT 0,
  is_available boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  cost_price numeric DEFAULT 0
);

CREATE TABLE public.download_batches (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  filename text NOT NULL,
  network text,
  order_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  idempotency_key text
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  title text NOT NULL,
  message text,
  type text,
  action_url text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  package_id uuid,
  phone_number text NOT NULL,
  amount numeric NOT NULL,
  status text DEFAULT 'pending'::text,
  reference text,
  network text,
  bundle_name text,
  provider_ref text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  download_batch_id uuid,
  idempotency_key text,
  size text,
  price numeric(12,2) DEFAULT 0,
  cost_price numeric(12,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid'::text,
  reference_code text,
  fulfillment_method text DEFAULT 'auto'::text,
  email text,
  customer_phone text,
  shop_id uuid,
  profit_amount numeric(12,2) DEFAULT 0,
  payment_metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.rate_limit_buckets (
  bucket_key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  window_start timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.shop_packages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL,
  package_id uuid NOT NULL,
  custom_price numeric(12,2),
  profit_margin numeric(12,2) DEFAULT 0,
  is_enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.shops (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  logo_url text,
  theme_color text DEFAULT '#0f172a'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.system_announcements (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  message text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.users (
  id uuid NOT NULL,
  email text,
  first_name text,
  last_name text,
  phone_number text,
  role text DEFAULT 'user'::text,
  status text DEFAULT 'active'::text,
  agent_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.wallet_payments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  wallet_id uuid,
  user_id uuid,
  reference text NOT NULL,
  amount numeric NOT NULL,
  status text DEFAULT 'pending'::text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  fee numeric DEFAULT 0,
  total_amount numeric,
  provider text DEFAULT 'paystack'::text,
  provider_reference text
);

CREATE TABLE public.wallet_transactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  wallet_id uuid,
  user_id uuid,
  type text NOT NULL,
  amount numeric NOT NULL,
  description text,
  reference text,
  source text,
  status text DEFAULT 'completed'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.wallets (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  balance numeric DEFAULT 0,
  total_credited numeric DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  total_spent numeric(12,2) DEFAULT 0
);

CREATE TABLE public.withdrawals (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  payment_method text,
  payment_details text,
  admin_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ---- Primary keys / unique / check constraints ------------------------------
ALTER TABLE admin_settings ADD CONSTRAINT admin_settings_pkey PRIMARY KEY (key);
ALTER TABLE complaints ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);
ALTER TABLE data_packages ADD CONSTRAINT data_packages_pkey PRIMARY KEY (id);
ALTER TABLE download_batches ADD CONSTRAINT download_batches_pkey PRIMARY KEY (id);
ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE rate_limit_buckets ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket_key);
ALTER TABLE shop_packages ADD CONSTRAINT shop_packages_pkey PRIMARY KEY (id);
ALTER TABLE shops ADD CONSTRAINT shops_pkey PRIMARY KEY (id);
ALTER TABLE system_announcements ADD CONSTRAINT system_announcements_pkey PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE wallet_payments ADD CONSTRAINT wallet_payments_pkey PRIMARY KEY (id);
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);
ALTER TABLE wallets ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);
ALTER TABLE download_batches ADD CONSTRAINT download_batches_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE orders ADD CONSTRAINT orders_reference_key UNIQUE (reference);
ALTER TABLE shop_packages ADD CONSTRAINT shop_packages_shop_id_package_id_key UNIQUE (shop_id, package_id);
ALTER TABLE shops ADD CONSTRAINT shops_slug_key UNIQUE (slug);
ALTER TABLE wallet_payments ADD CONSTRAINT wallet_payments_reference_key UNIQUE (reference);
ALTER TABLE wallets ADD CONSTRAINT unique_user_wallet UNIQUE (user_id);
ALTER TABLE users ADD CONSTRAINT user_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'sub-admin'::text, 'agent'::text, 'customer'::text, 'user'::text])));
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

-- ---- Foreign keys -----------------------------------------------------------
ALTER TABLE complaints ADD CONSTRAINT complaints_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
ALTER TABLE complaints ADD CONSTRAINT complaints_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE download_batches ADD CONSTRAINT download_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE orders ADD CONSTRAINT orders_batch_id_fkey FOREIGN KEY (download_batch_id) REFERENCES download_batches(id);
ALTER TABLE orders ADD CONSTRAINT orders_package_id_fkey FOREIGN KEY (package_id) REFERENCES data_packages(id);
ALTER TABLE orders ADD CONSTRAINT orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE shop_packages ADD CONSTRAINT shop_packages_package_id_fkey FOREIGN KEY (package_id) REFERENCES data_packages(id) ON DELETE CASCADE;
ALTER TABLE shop_packages ADD CONSTRAINT shop_packages_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
ALTER TABLE shops ADD CONSTRAINT shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE wallet_payments ADD CONSTRAINT wallet_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE wallet_payments ADD CONSTRAINT wallet_payments_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES wallets(id);
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES wallets(id);
ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---- Indexes ----------------------------------------------------------------
CREATE INDEX idx_orders_idempotency_key ON public.orders USING btree (idempotency_key);
CREATE UNIQUE INDEX withdrawals_one_pending_per_user ON public.withdrawals USING btree (user_id) WHERE (status = 'pending'::text);

-- ---- Functions (RPCs) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_wallet(p_wallet_id uuid, p_amount numeric)
 RETURNS TABLE(id uuid, user_id uuid, balance numeric, total_credited numeric, total_spent numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;

  RETURN QUERY
  UPDATE public.wallets w
  SET balance = w.balance - p_amount,
      total_spent = w.total_spent + p_amount,
      updated_at = now()
  WHERE w.id = p_wallet_id
    AND w.balance >= p_amount
  RETURNING w.id, w.user_id, w.balance, w.total_credited, w.total_spent;
END;
$function$;

CREATE OR REPLACE FUNCTION public.credit_wallet(p_wallet_id uuid, p_amount numeric)
 RETURNS TABLE(id uuid, user_id uuid, balance numeric, total_credited numeric, total_spent numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;

  RETURN QUERY
  UPDATE public.wallets w
  SET balance = w.balance + p_amount,
      total_credited = w.total_credited + p_amount,
      updated_at = now()
  WHERE w.id = p_wallet_id
  RETURNING w.id, w.user_id, w.balance, w.total_credited, w.total_spent;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refund_wallet(p_wallet_id uuid, p_amount numeric)
 RETURNS TABLE(id uuid, user_id uuid, balance numeric, total_credited numeric, total_spent numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;

  RETURN QUERY
  UPDATE public.wallets w
  SET balance = w.balance + p_amount,
      total_spent = w.total_spent - p_amount,
      updated_at = now()
  WHERE w.id = p_wallet_id
  RETURNING w.id, w.user_id, w.balance, w.total_credited, w.total_spent;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, phone_number, role, status, created_at, updated_at)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'phone_number',
    COALESCE(new.raw_user_meta_data->>'role', 'user'),
    'active',
    NOW(),
    NOW()
  );

  INSERT INTO public.wallets (user_id, balance, total_credited)
  VALUES (new.id, 0.00, 0.00);
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_max_attempts integer, p_window_seconds integer)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_now timestamptz := now();
    v_count integer;
    v_window_start timestamptz;
BEGIN
    INSERT INTO public.rate_limit_buckets (bucket_key, count, window_start)
    VALUES (p_key, 1, v_now)
    ON CONFLICT (bucket_key) DO UPDATE SET
        count = CASE
            WHEN public.rate_limit_buckets.window_start <= v_now - (p_window_seconds || ' seconds')::interval
                THEN 1
            ELSE public.rate_limit_buckets.count + 1
        END,
        window_start = CASE
            WHEN public.rate_limit_buckets.window_start <= v_now - (p_window_seconds || ' seconds')::interval
                THEN v_now
            ELSE public.rate_limit_buckets.window_start
        END
    RETURNING public.rate_limit_buckets.count, public.rate_limit_buckets.window_start
    INTO v_count, v_window_start;

    RETURN QUERY SELECT
        v_count <= p_max_attempts,
        GREATEST(p_max_attempts - v_count, 0),
        GREATEST(CEIL(EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::interval - v_now)))::integer, 0);
END;
$function$;

-- ---- Trigger: auto-provision public.users + wallet on auth signup -----------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---- Row Level Security -----------------------------------------------------
ALTER TABLE public.data_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_packages_public_read ON public.data_packages AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY wallet_transactions_admin_read ON public.wallet_transactions AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::text, 'sub-admin'::text]))))));
CREATE POLICY wallet_transactions_insert_own ON public.wallet_transactions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY wallet_transactions_select_own ON public.wallet_transactions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY notifications_delete_own ON public.notifications AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY notifications_select_own ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY notifications_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY complaints_insert_own ON public.complaints AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY complaints_select_own ON public.complaints AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own wallet" ON public.wallets AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Allow read access to admins" ON public.download_batches AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::text, 'sub-admin'::text]))))));
CREATE POLICY "Allow write access to admins" ON public.download_batches AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::text, 'sub-admin'::text]))))));
CREATE POLICY "Allow read access to all users" ON public.admin_settings AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Allow write access to admins only" ON public.admin_settings AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::text, 'sub-admin'::text]))))));
CREATE POLICY wallet_payments_select_own ON public.wallet_payments AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own profile" ON public.users AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = id));
CREATE POLICY "Admins can manage announcements" ON public.system_announcements AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text)))));
CREATE POLICY "Anyone can read active announcements" ON public.system_announcements AS PERMISSIVE FOR SELECT TO public USING ((is_active = true));
CREATE POLICY "Everyone can read active announcements" ON public.system_announcements AS PERMISSIVE FOR SELECT TO public USING ((is_active = true));
CREATE POLICY "Shop owners can view their shop orders" ON public.orders AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM shops WHERE ((shops.id = orders.shop_id) AND (shops.user_id = auth.uid())))));
CREATE POLICY orders_insert_own ON public.orders AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid() = user_id) OR (user_id IS NULL)));
CREATE POLICY orders_select_guest ON public.orders AS PERMISSIVE FOR SELECT TO public USING ((user_id IS NULL));
CREATE POLICY orders_select_own ON public.orders AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Shop owners can manage their packages" ON public.shop_packages AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM shops WHERE ((shops.id = shop_packages.shop_id) AND (shops.user_id = auth.uid())))));
CREATE POLICY "Shop packages are viewable by everyone" ON public.shop_packages AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Public shops are viewable by everyone" ON public.shops AS PERMISSIVE FOR SELECT TO public USING ((is_active = true));
CREATE POLICY "Users can manage their own shop" ON public.shops AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Admins can view and update all withdrawals" ON public.withdrawals AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::text, 'sub-admin'::text]))))));
CREATE POLICY "Users can create their own withdrawal requests" ON public.withdrawals AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can view their own withdrawals" ON public.withdrawals AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
