'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { DEFAULT_FEE_PERCENT, FEE_SETTING_KEYS, pickFeePercent } from '@/lib/pay/fee'

/**
 * Paystack fee percent for the signed-in user's role, picked with the same rule the
 * server charges with (lib/pay/fee pickFeePercent). Display only: the server recomputes.
 */
export function usePaystackFeePercent(role: string | null | undefined): number {
    const [feePercent, setFeePercent] = useState(DEFAULT_FEE_PERCENT)

    useEffect(() => {
        let cancelled = false
        supabase
            .from('admin_settings')
            .select('key, value')
            .in('key', [...FEE_SETTING_KEYS])
            .then(({ data }) => {
                if (!cancelled) setFeePercent(pickFeePercent(data as any, role))
            })
        return () => { cancelled = true }
    }, [role])

    return feePercent
}
