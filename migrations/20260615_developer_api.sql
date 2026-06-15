-- Developer API: api keys, webhook deliveries, per-user idempotency

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  label text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  rate_limit_per_min integer NOT NULL DEFAULT 60,
  webhook_url text,
  webhook_secret text,
  webhook_events text[] NOT NULL DEFAULT ARRAY['order.completed','order.failed','order.refunded'],
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys (user_id);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.api_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  event text NOT NULL,
  order_id uuid,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_response_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON public.api_webhook_deliveries (status, next_attempt_at);
ALTER TABLE public.api_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key
  ON public.orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
