-- Applied to the live project on 2026-10-20 (migration: wallet_transactions_unique_credit_reference).
-- One wallet credit per payment reference. The payment flow and the reconciliation
-- fix both write source 'payment' / 'reconciliation' credits keyed by the Paystack
-- reference, so a repeat (retry, double click, race) is rejected by the database.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_credit_reference_uniq
    ON public.wallet_transactions (reference)
    WHERE type = 'credit' AND source IN ('payment', 'reconciliation') AND reference IS NOT NULL;
