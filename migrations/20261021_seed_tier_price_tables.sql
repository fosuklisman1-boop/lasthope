-- Applied to the live project on 2026-10-21 (migration: seed_tier_price_tables_from_columns).
-- Move the four built-in reseller tiers from per-tier columns on data_packages onto price tables.
-- Refuses to run if any price would change when stored to two decimals.
DO $$
DECLARE
    t record;
    tbl_id uuid;
    bad integer;
BEGIN
    SELECT count(*) INTO bad FROM public.data_packages
    WHERE (agent_price > 0 AND agent_price <> round(agent_price, 2))
       OR (super_agent_price > 0 AND super_agent_price <> round(super_agent_price, 2))
       OR (premium_agent_price > 0 AND premium_agent_price <> round(premium_agent_price, 2))
       OR (dealer_price > 0 AND dealer_price <> round(dealer_price, 2));
    IF bad > 0 THEN
        RAISE EXCEPTION 'Aborting: % package(s) have tier prices with more than two decimals', bad;
    END IF;

    FOR t IN
        SELECT * FROM (VALUES
            ('agent',         'Agent prices',         'agent_price'),
            ('super-agent',   'Super agent prices',   'super_agent_price'),
            ('premium-agent', 'Premium agent prices', 'premium_agent_price'),
            ('dealer',        'Dealer prices',        'dealer_price')
        ) AS v(slug, table_name, col)
    LOOP
        -- reuse the table if it already exists (re-runnable)
        SELECT id INTO tbl_id FROM public.price_tables WHERE lower(btrim(name)) = lower(t.table_name);
        IF tbl_id IS NULL THEN
            INSERT INTO public.price_tables (name, description)
            VALUES (t.table_name, 'Created from the original ' || t.slug || ' prices')
            RETURNING id INTO tbl_id;
        END IF;

        EXECUTE format(
            'INSERT INTO public.price_table_items (price_table_id, package_id, price)
             SELECT $1, id, %I FROM public.data_packages WHERE %I > 0
             ON CONFLICT (price_table_id, package_id) DO NOTHING', t.col, t.col)
        USING tbl_id;

        UPDATE public.roles SET price_table_id = tbl_id WHERE slug = t.slug AND price_table_id IS NULL;
    END LOOP;
END $$;
