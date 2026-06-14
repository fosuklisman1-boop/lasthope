-- Migration: Create Shops and Withdrawals Schema
-- Date: 2026-03-20

-- 1. Create shops table
CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    theme_color TEXT DEFAULT '#0f172a',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create shop_packages table for custom pricing
CREATE TABLE IF NOT EXISTS public.shop_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES public.data_packages(id) ON DELETE CASCADE,
    custom_price DECIMAL(12,2), -- Optional override
    profit_margin DECIMAL(12,2) DEFAULT 0, -- Margin added to base price
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shop_id, package_id)
);

-- 3. Create withdrawals table
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    payment_method TEXT, -- e.g. "MTN MoMo", "Bank Transfer"
    payment_details TEXT, -- Account number, etc.
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Update orders table to include shop attribution and profit
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES public.shops(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS profit_amount DECIMAL(12,2) DEFAULT 0;

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS Policies (Idempotent)

-- Shops policies
DROP POLICY IF EXISTS "Public shops are viewable by everyone" ON public.shops;
CREATE POLICY "Public shops are viewable by everyone" ON public.shops
    FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Users can manage their own shop" ON public.shops;
CREATE POLICY "Users can manage their own shop" ON public.shops
    FOR ALL USING (auth.uid() = user_id);

-- Shop Packages policies
DROP POLICY IF EXISTS "Shop packages are viewable by everyone" ON public.shop_packages;
CREATE POLICY "Shop packages are viewable by everyone" ON public.shop_packages
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Shop owners can manage their packages" ON public.shop_packages;
CREATE POLICY "Shop owners can manage their packages" ON public.shop_packages
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.shops
            WHERE shops.id = shop_packages.shop_id
            AND shops.user_id = auth.uid()
        )
    );

-- Withdrawals policies
DROP POLICY IF EXISTS "Users can view their own withdrawals" ON public.withdrawals;
CREATE POLICY "Users can view their own withdrawals" ON public.withdrawals
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own withdrawal requests" ON public.withdrawals;
CREATE POLICY "Users can create their own withdrawal requests" ON public.withdrawals
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view and update all withdrawals" ON public.withdrawals;
CREATE POLICY "Admins can view and update all withdrawals" ON public.withdrawals
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role IN ('admin', 'sub-admin')
        )
    );

-- Orders policies for shop owners
DROP POLICY IF EXISTS "Shop owners can view their shop orders" ON public.orders;
CREATE POLICY "Shop owners can view their shop orders" ON public.orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.shops
            WHERE shops.id = orders.shop_id
            AND shops.user_id = auth.uid()
        )
    );
