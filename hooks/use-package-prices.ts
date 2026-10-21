import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { getPriceForRole, type PackagePricing } from '@/lib/pricing'

/**
 * Prices for the signed-in customer, worked out on the server (their role's price table
 * and any prices an admin set just for them). Until the server answers, or if it cannot,
 * it falls back to the per-tier price, which is what the browser used before. The server
 * always recalculates the price when an order is placed, so this is for display.
 */
export function usePackagePrices() {
    const { user, dbUser } = useAuth()
    const [prices, setPrices] = useState<Record<string, number> | null>(null)

    useEffect(() => {
        if (!user?.id) return
        let cancelled = false
        fetch('/api/pricing/me', { cache: 'no-store' })
            .then(res => (res.ok ? res.json() : null))
            .then(json => { if (!cancelled && json?.prices) setPrices(json.prices) })
            .catch(() => undefined)
        return () => { cancelled = true }
    }, [user?.id, dbUser?.role])

    const priceFor = useCallback(
        (pkg: PackagePricing) => (pkg.id && prices?.[pkg.id]) || getPriceForRole(pkg, dbUser?.role),
        [prices, dbUser?.role]
    )

    return { priceFor, ready: prices !== null }
}
