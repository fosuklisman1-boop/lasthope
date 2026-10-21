'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { roleConfig, setRoleRegistry, type RoleInfo } from '@/lib/roles'

interface RolesContextValue {
    /** Every role, in display order. Falls back to the built-in roles until the list loads. */
    roles: RoleInfo[]
    loaded: boolean
    reload: () => Promise<void>
}

const builtinRoles: RoleInfo[] = Object.entries(roleConfig).map(([slug, c], i) => ({
    slug,
    label: c.label,
    kind: 'system' as const,
    is_reseller: ['agent', 'super-agent', 'premium-agent', 'dealer'].includes(slug),
    color: c.color,
    icon: '',
    rank: i + 1,
    upgradable: false,
    upgrade_price: null,
}))

const RolesContext = createContext<RolesContextValue>({ roles: builtinRoles, loaded: false, reload: async () => undefined })

/**
 * Loads the role list (names, colours, reseller flag) once and feeds it to lib/roles, so a role an
 * admin adds shows up everywhere. If the request fails the built-in roles keep working.
 */
export function RolesProvider({ children }: { children: React.ReactNode }) {
    const [roles, setRoles] = useState<RoleInfo[]>(builtinRoles)
    const [loaded, setLoaded] = useState(false)

    const reload = useCallback(async () => {
        try {
            const res = await fetch('/api/roles', { cache: 'no-store' })
            if (!res.ok) return
            const json = await res.json()
            if (Array.isArray(json.roles) && json.roles.length > 0) {
                setRoleRegistry(json.roles) // before the state update, so components that re-render can read it
                setRoles(json.roles)
            }
        } catch {
            // keep the built-in roles
        } finally {
            setLoaded(true)
        }
    }, [])

    useEffect(() => { reload() }, [reload])

    const value = useMemo(() => ({ roles, loaded, reload }), [roles, loaded, reload])
    return <RolesContext.Provider value={value}>{children}</RolesContext.Provider>
}

export function useRoles(): RolesContextValue {
    return useContext(RolesContext)
}
