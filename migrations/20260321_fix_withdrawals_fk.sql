-- Migration: Fix Withdrawals Foreign Key and RLS
-- Date: 2026-03-21

-- 1. Explicitly point user_id to public.users for easier joining
ALTER TABLE public.withdrawals 
    DROP CONSTRAINT IF EXISTS withdrawals_user_id_fkey,
    ADD CONSTRAINT withdrawals_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 2. Make RLS policies even more robust for admins
DROP POLICY IF EXISTS "Admins can view and update all withdrawals" ON public.withdrawals;
CREATE POLICY "Admins can view and update all withdrawals" ON public.withdrawals
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'sub-admin')
        )
    );

-- 3. Ensure users can see their own (including if they are admins)
DROP POLICY IF EXISTS "Users can view their own withdrawals" ON public.withdrawals;
CREATE POLICY "Users can view their own withdrawals" ON public.withdrawals
    FOR SELECT USING (auth.uid() = user_id);
