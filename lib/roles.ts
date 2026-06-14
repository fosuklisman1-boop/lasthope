import { Crown, Star, BadgeCheck, Gem, Award, Briefcase, UserCircle, LucideIcon } from 'lucide-react'

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
  return !!role && (RESELLER_TIERS as string[]).includes(role)
}

// Maps each reseller tier to its data_packages price column.
export const TIER_PRICE_FIELD: Record<string, string> = {
  'agent': 'agent_price',
  'super-agent': 'super_agent_price',
  'premium-agent': 'premium_agent_price',
  'dealer': 'dealer_price',
}
