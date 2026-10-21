-- Applied to the live project on 2026-10-21 (migration: handle_new_user_ignore_client_role).
-- raw_user_meta_data is supplied by the person signing up, so it must never decide the role.
-- Anyone could call signUp with data: { role: 'admin' } and become an admin (or pick the
-- cheapest price tier). New accounts are always plain customers; an admin changes roles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, phone_number, role, status, created_at, updated_at)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'phone_number',
    'user',
    'active',
    NOW(),
    NOW()
  );

  INSERT INTO public.wallets (user_id, balance, total_credited)
  VALUES (new.id, 0.00, 0.00);
  RETURN new;
END;
$$;
