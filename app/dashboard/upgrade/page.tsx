'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/auth-context'
import { supabase } from '@/lib/supabase'
import { RESELLER_TIERS, roleConfig, UserRole, isResellerRole } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Crown, Zap, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import CongratsModal from '@/components/upgrade/CongratsModal'
import { cn } from '@/lib/utils'
import { useTutorial } from '@/hooks/useTutorial'
import { HelpButton } from '@/components/tutorial/HelpButton'

// Per-tier card styling
const TIER_STYLE: Record<string, { color: string; buttonClass: string; badgeColor: string; priceColor: string; bgClass: string; popular: boolean }> = {
    'agent': {
        color: 'border-white/15',
        buttonClass: 'bg-[hsl(var(--secondary))] hover:brightness-125 text-foreground',
        badgeColor: 'from-slate-500 to-slate-600',
        priceColor: 'text-foreground',
        bgClass: 'bg-card',
        popular: false,
    },
    'super-agent': {
        color: 'border-[hsl(var(--neon-amber)/0.55)] shadow-[0_0_34px_hsl(var(--neon-amber)/0.16)]',
        buttonClass: 'bg-[hsl(var(--neon-amber))] hover:brightness-110 text-[hsl(35_80%_8%)]',
        badgeColor: 'from-[#FFCE00] to-[#E6B800]',
        priceColor: 'text-[hsl(var(--neon-amber))]',
        bgClass: 'bg-card',
        popular: true,
    },
    'premium-agent': {
        color: 'border-[hsl(var(--neon-cyan)/0.55)] shadow-[0_0_34px_hsl(var(--neon-cyan)/0.16)]',
        buttonClass: 'bg-[hsl(var(--neon-cyan))] hover:brightness-110 text-[hsl(200_80%_8%)]',
        badgeColor: 'from-sky-500 to-blue-600',
        priceColor: 'text-[hsl(var(--neon-cyan))]',
        bgClass: 'bg-card',
        popular: false,
    },
    'dealer': {
        color: 'border-[hsl(var(--neon-violet)/0.55)] shadow-[0_0_34px_hsl(var(--neon-violet)/0.16)]',
        buttonClass: 'bg-[hsl(var(--neon-violet))] hover:brightness-110 text-[hsl(252_80%_8%)]',
        badgeColor: 'from-purple-600 to-indigo-700',
        priceColor: 'text-[hsl(var(--neon-violet))]',
        bgClass: 'bg-card',
        popular: false,
    },
}

const commonFeatures = [
    'Exclusive Wholesale Pricing',
    'Priority Customer Support',
    '0% Top Up Charges (Admin Manual Top Up)',
    'Faster Order Processing',
    'Bulk Order Import Feature',
    'New Exclusive UI Design Features',
    'The Awaited "Shop" Feature (Coming Soon)'
]

export default function UpgradePage() {
    const { dbUser, refreshUser } = useAuth()
    const router = useRouter()
    const searchParams = useSearchParams()

    // Tutorial hook
    const userRole = isResellerRole(dbUser?.role) ? 'agent' : 'customer'
    const { startTutorial } = useTutorial(userRole as 'customer' | 'agent', '/upgrade')

    // Congrats modal state
    const [showCongrats, setShowCongrats] = useState(false)
    const [showFallbackButton, setShowFallbackButton] = useState(false)

    // One-time prices per tier
    const [prices, setPrices] = useState<Record<string, number>>({})
    const [isLoading, setIsLoading] = useState(true)
    const [isProcessing, setIsProcessing] = useState<string | null>(null)

    // Fetch tier prices from admin_settings (public-read RLS)
    useEffect(() => {
        const keys = RESELLER_TIERS.map(t => 'upgrade_price_' + t.replace(/-/g, '_'))
        supabase
            .from('admin_settings')
            .select('key, value')
            .in('key', keys)
            .then(({ data, error }) => {
                if (error) {
                    console.error('Failed to fetch upgrade prices:', error)
                    toast.error('Failed to load upgrade prices.')
                } else {
                    const rows = (data ?? []) as { key: string; value: string }[]
                    const map: Record<string, number> = {}
                    for (const t of RESELLER_TIERS) {
                        const key = 'upgrade_price_' + t.replace(/-/g, '_')
                        map[t] = Number(rows.find(r => r.key === key)?.value || 0)
                    }
                    setPrices(map)
                }
                setIsLoading(false)
            })
    }, [])

    const [isVerifying, setIsVerifying] = useState(false)

    // Detect successful payment and show congrats modal
    useEffect(() => {
        const success = searchParams.get('success') === 'true'

        if (success) {
            const verifyAndShowCongrats = async () => {
                const isReseller = dbUser?.role && RESELLER_TIERS.includes(dbUser.role as UserRole)

                let isRecentlyUpdated = false
                if (dbUser?.updated_at) {
                    const updateTime = new Date(dbUser.updated_at).getTime()
                    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000)
                    isRecentlyUpdated = updateTime > fiveMinutesAgo
                }

                const isConfirmed = isReseller && isRecentlyUpdated

                if (isConfirmed) {
                    setShowCongrats(true)
                    setIsVerifying(false)
                    window.history.replaceState({}, '', '/dashboard/upgrade')
                } else {
                    setIsVerifying(true)
                    const timer = setTimeout(() => {
                        if (dbUser) {
                            refreshUser()
                        } else {
                            window.location.reload()
                        }
                    }, 3000)
                    return () => clearTimeout(timer)
                }
            }

            verifyAndShowCongrats()
        } else {
            setShowFallbackButton(false)
        }
    }, [searchParams, dbUser, refreshUser])

    // Timer for fallback button during verification
    useEffect(() => {
        let timer: NodeJS.Timeout
        if (isVerifying) {
            timer = setTimeout(() => {
                setShowFallbackButton(true)
            }, 10000)
        } else {
            setShowFallbackButton(false)
        }
        return () => {
            if (timer) clearTimeout(timer)
        }
    }, [isVerifying])

    async function startUpgrade(tier: UserRole) {
        setIsProcessing(tier)
        try {
            const res = await fetch('/api/user/upgrade/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier }),
            })
            const data = await res.json()
            if (data.authorization_url) {
                window.location.href = data.authorization_url
            } else {
                toast.error(data.error || 'Failed to start upgrade process')
                setIsProcessing(null)
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to start upgrade process'
            toast.error(message)
            setIsProcessing(null)
        }
    }

    if (isLoading || isVerifying) {
        return (
            <div className="fixed inset-0 bg-background flex items-center justify-center z-50 p-6">
                <div className="flex flex-col items-center gap-6 max-w-sm w-full">
                    <div className="relative">
                        <Crown className="w-16 h-16 text-yellow-600 animate-bounce relative z-10" />
                    </div>
                    {isVerifying && (
                        <div className="text-center space-y-4 w-full">
                            <div className="space-y-2">
                                <h2 className="text-2xl font-black text-yellow-800">Verifying Payment...</h2>
                                <p className="text-yellow-700 font-bold animate-pulse">Please wait while we activate your upgrade.</p>
                            </div>

                            {showFallbackButton && (
                                <div className="pt-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                    <p className="text-yellow-800/80 text-xs font-black uppercase tracking-widest">Taking longer than expected?</p>
                                    <div className="grid grid-cols-1 gap-3">
                                        <Button
                                            onClick={() => window.location.reload()}
                                            variant="outline"
                                            className="bg-white/50 border-yellow-400 text-yellow-800 font-black hover:bg-white/80 rounded-xl"
                                        >
                                            Refresh Page
                                        </Button>
                                        <Button
                                            onClick={() => router.push('/dashboard')}
                                            className="bg-black text-[#FFCE00] font-black hover:bg-black/90 rounded-xl"
                                        >
                                            Go to Dashboard
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <>
            {/* Congrats Modal */}
            {showCongrats && (
                <CongratsModal
                    onClose={() => setShowCongrats(false)}
                    onBrowsePackages={() => router.push('/dashboard/data-packages')}
                />
            )}

            <div className="relative -m-4 sm:-m-6 min-h-[calc(100vh+2rem)] lg:min-h-screen overflow-x-hidden selection:bg-primary/30 px-4 sm:px-6 py-10 sm:py-16 flex flex-col items-center scroll-smooth" style={{ fontFamily: '"Fira Sans", sans-serif' }}>

                <div className="relative z-10 w-full max-w-6xl flex flex-col items-center">

                    {/* Header Section */}
                    <div className="text-center mb-8 sm:mb-12 space-y-3 sm:space-y-4 relative w-full">
                        {/* Help Button */}
                        <div className="absolute top-0 right-0 z-20">
                            <HelpButton onClick={startTutorial} />
                        </div>

                        <div className="mb-4 sm:mb-6 flex justify-center">
                            <div className="relative">
                                <Crown className="w-20 h-20 sm:w-28 sm:h-28 text-[hsl(var(--neon-amber))] animate-[bounce_2s_infinite] drop-shadow-[0_0_22px_hsl(var(--neon-amber)/0.55)]" />
                            </div>
                        </div>

                        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-foreground leading-tight">
                            <span className="relative inline-block">
                                <span className="relative">
                                    U
                                    <Crown className="absolute -top-6 -left-3 w-8 h-8 sm:w-12 sm:h-12 text-yellow-500 fill-yellow-500 -rotate-[25deg] drop-shadow-md" />
                                </span>
                                PGRADE YOUR TIER
                            </span>
                        </h1>

                        <p id="agent-benefits" className="text-sm sm:text-base lg:text-lg text-white font-black max-w-3xl mx-auto px-4 drop-shadow-sm">
                            Choose a reseller tier below. Each upgrade is a one-time permanent unlock — no expiry, no renewals.
                        </p>
                    </div>

                    {/* Tier Cards Grid */}
                    <div id="pricing-plans" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6 mb-12 w-full max-w-5xl items-stretch">
                        {RESELLER_TIERS.map((tier) => {
                            const style = TIER_STYLE[tier]
                            const config = roleConfig[tier]
                            const Icon = config.icon
                            const price = prices[tier]
                            const hasPrice = price && price > 0

                            return (
                                <div
                                    key={tier}
                                    className={cn(
                                        "neo-raised relative rounded-[1.75rem] p-6 flex flex-col transition-all duration-500 border",
                                        style.bgClass,
                                        style.color,
                                        style.popular ? 'md:scale-105 z-10' : 'opacity-95'
                                    )}
                                >
                                    {/* Badge */}
                                    <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 sm:px-4 py-1.5 bg-gradient-to-r ${style.badgeColor} rounded-full shadow-lg z-20 flex items-center gap-1.5 sm:gap-2`}>
                                        <Icon className="w-3 h-3 text-white" />
                                        <span className="text-[10px] font-black text-white uppercase tracking-wider sm:tracking-widest">
                                            {config.label}
                                        </span>
                                    </div>

                                    <div className="text-center mb-5 space-y-1">
                                        <h3 className="text-xl sm:text-2xl font-black text-foreground border-b border-white/10 pb-2">{config.label}</h3>
                                        <p className="text-gray-400 text-xs sm:text-sm font-bold pt-1">One-time upgrade</p>
                                    </div>

                                    <div className="text-center mb-6 flex flex-col items-center justify-center gap-1">
                                        <div className="flex items-baseline justify-center gap-1.5">
                                            <span className={`font-black text-base sm:text-lg ${style.priceColor}`}>GHS</span>
                                            <span className={`text-4xl sm:text-5xl font-black ${style.priceColor} tracking-tighter`}>
                                                {hasPrice ? price.toString().split('.')[0] : '--'}
                                                {hasPrice && (
                                                    <span className="text-2xl sm:text-3xl font-black">
                                                        {'.' + price.toFixed(2).split('.')[1]}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="space-y-3 mb-8 flex-1">
                                        {commonFeatures.map((feature, i) => {
                                            const isComingSoon = feature.toLowerCase().includes('coming soon')
                                            return (
                                                <div key={i} className="flex items-start gap-2.5">
                                                    <div className={cn(
                                                        "mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                                                        isComingSoon ? "bg-yellow-100" : "bg-green-50"
                                                    )}>
                                                        <CheckCircle className={cn(
                                                            "w-3.5 h-3.5",
                                                            isComingSoon ? "text-yellow-500" : "text-green-500"
                                                        )} />
                                                    </div>
                                                    <span className="text-xs sm:text-sm font-bold text-gray-700 leading-snug">{feature}</span>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    <Button
                                        onClick={() => startUpgrade(tier as UserRole)}
                                        disabled={isProcessing !== null || !hasPrice}
                                        className={`clay w-full h-11 sm:h-12 rounded-xl text-sm sm:text-base font-black transition-all active:translate-y-px text-white ${style.buttonClass}`}
                                    >
                                        {isProcessing === tier ? (
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        ) : (
                                            'Upgrade Now'
                                        )}
                                    </Button>
                                </div>
                            )
                        })}
                    </div>

                    {/* Secure Badge Section */}
                    <div className="w-full max-w-3xl">
                        <div className="neo-raised rounded-[1.75rem] p-6 sm:p-10 border border-white/[0.05] flex flex-col items-center text-center space-y-6">
                            <div className="inline-flex items-center gap-2 text-amber-600 bg-[hsl(var(--neon-amber)/0.12)] px-4 py-1.5 rounded-full border border-[hsl(var(--neon-amber)/0.30)]">
                                <Zap className="w-5 h-5 fill-current" />
                                <span className="text-xs font-black uppercase tracking-[0.2em]">FAST & SECURE</span>
                            </div>
                            <p className="text-base text-gray-500 font-bold leading-relaxed max-w-xl">
                                Upgrade your account in seconds using card, mobile money or bank transfer via Paystack. Your new tier activates immediately — permanently.
                            </p>
                            <div className="flex items-center gap-3 pt-2 grayscale opacity-50">
                                <div className="w-7 h-7 bg-gray-200 rounded-lg flex items-center justify-center text-[10px] font-black text-gray-500 border border-gray-300">?</div>
                                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">SECURE PAYMENTS BY PAYSTACK</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
