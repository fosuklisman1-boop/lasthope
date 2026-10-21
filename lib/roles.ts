import { Crown, Star, BadgeCheck, Gem, Award, Briefcase, UserCircle, Zap, Shield, Rocket, Heart, Flame, Sparkles, Store, Users, Trophy, LucideIcon } from 'lucide-react'

export type UserRole =
  | 'admin'
  | 'sub-admin'
  | 'agent'
  | 'super-agent'
  | 'premium-agent'
  | 'dealer'
  | 'user'

interface RoleConfigItem {
  icon: LucideIcon
  label: string
  rank: string
  color: string
  bgColor: string
  textColor: string
}

export const roleConfig: Record<UserRole, RoleConfigItem> = {
  'admin': { icon: Crown, label: 'Admin', rank: '#1', color: '#E60000', bgColor: 'rgba(230, 0, 0, 0.1)', textColor: '#E60000' },
  'sub-admin': { icon: Star, label: 'Sub-Admin', rank: '#2', color: '#FACC15', bgColor: 'rgba(250, 204, 21, 0.15)', textColor: '#B59410' },
  'dealer': { icon: Briefcase, label: 'Dealer', rank: '#3', color: '#7C3AED', bgColor: 'rgba(124, 58, 237, 0.1)', textColor: '#7C3AED' },
  'premium-agent': { icon: Gem, label: 'Premium Agent', rank: '#4', color: '#0EA5E9', bgColor: 'rgba(14, 165, 233, 0.1)', textColor: '#0EA5E9' },
  'super-agent': { icon: Award, label: 'Super Agent', rank: '#5', color: '#F59E0B', bgColor: 'rgba(245, 158, 11, 0.1)', textColor: '#B45309' },
  'agent': { icon: BadgeCheck, label: 'Agent', rank: '#6', color: '#25D366', bgColor: 'rgba(37, 211, 102, 0.1)', textColor: '#25D366' },
  'user': { icon: UserCircle, label: 'Customer', rank: '#7', color: '#0056B3', bgColor: 'rgba(0, 86, 179, 0.1)', textColor: '#0056B3' },
}

// Reseller tiers ordered base price -> cheapest (best) price.
export const RESELLER_TIERS: UserRole[] = ['agent', 'super-agent', 'premium-agent', 'dealer']

export function isResellerRole(role: string | null | undefined): boolean {
  if (!role) return false
  const info = registry.get(role) // a role stored in the database decides for itself
  if (info) return info.is_reseller
  return (RESELLER_TIERS as string[]).includes(role)
}

// Maps each reseller tier to its data_packages price column.
export const TIER_PRICE_FIELD: Record<string, string> = {
  'agent': 'agent_price',
  'super-agent': 'super_agent_price',
  'premium-agent': 'premium_agent_price',
  'dealer': 'dealer_price',
}

// ── Roles stored in the database ─────────────────────────────────────────
// The seven built-in roles above are the fallback. Admins can add more in the database;
// the browser loads them into this registry so labels, colours and the reseller flag work
// for every role.

export const ROLE_ICONS: Record<string, LucideIcon> = {
  Crown, Star, BadgeCheck, Gem, Award, Briefcase, UserCircle,
  Zap, Shield, Rocket, Heart, Flame, Sparkles, Store, Users, Trophy,
}
export const ROLE_ICON_NAMES = Object.keys(ROLE_ICONS)

export interface RoleInfo {
  slug: string
  label: string
  kind: 'system' | 'custom'
  is_reseller: boolean
  color: string
  icon: string
  rank: number
  upgradable: boolean
  upgrade_price: number | null
}

let registry = new Map<string, RoleInfo>()

export function setRoleRegistry(rows: RoleInfo[]): void {
  registry = new Map(rows.map(r => [r.slug, r]))
}

export function getRoleRegistry(): RoleInfo[] {
  return Array.from(registry.values()).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
}

export function getRoleInfo(slug: string | null | undefined): RoleInfo | undefined {
  return slug ? registry.get(slug) : undefined
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return `rgba(100, 116, 139, ${alpha})`
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

function titleCase(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Presentation for any role. Never undefined, so an unknown or brand-new role cannot crash a screen. */
export function getRoleConfig(slug: string | null | undefined): RoleConfigItem {
  const key = slug || 'user'
  const info = registry.get(key)
  if (info) {
    return {
      icon: ROLE_ICONS[info.icon] ?? BadgeCheck,
      label: info.label,
      rank: `#${info.rank}`,
      color: info.color,
      bgColor: hexToRgba(info.color, 0.1),
      textColor: info.color,
    }
  }
  const builtin = (roleConfig as Record<string, RoleConfigItem>)[key]
  if (builtin) return builtin
  return { icon: BadgeCheck, label: titleCase(key), rank: '#—', color: '#64748B', bgColor: hexToRgba('#64748B', 0.1), textColor: '#64748B' }
}
