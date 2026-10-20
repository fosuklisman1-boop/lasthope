'use client'

import { useEffect, useState } from 'react'
import { clearPricingCache } from '@/lib/pricing-cache'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Users,
    ShieldCheck,
    Plus,
    Save,
    Loader2,
    Search,
    RefreshCw,
} from 'lucide-react'
import { RESELLER_TIERS, roleConfig, isResellerRole } from '@/lib/roles'
import { toast } from 'sonner'

export default function AdminMembershipsPage() {
    const [agents, setAgents] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isSavingPrices, setIsSavingPrices] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Pricing state — keyed by tier slug
    const [prices, setPrices] = useState<Record<string, string>>(
        Object.fromEntries(RESELLER_TIERS.map(t => [t, '0']))
    )

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        try {
            // Fetch upgrade prices from API
            const pricesResponse = await fetch('/api/admin/get-prices')
            if (pricesResponse.ok) {
                const pricesData = await pricesResponse.json()
                if (pricesData.prices) {
                    setPrices(Object.fromEntries(
                        RESELLER_TIERS.map(t => [t, String(pricesData.prices[t] ?? '0')])
                    ))
                }
            }

            // Fetch Agents via API route (bypasses RLS)
            const agentsResponse = await fetch('/api/admin/agents')

            if (!agentsResponse.ok) {
                const errorData = await agentsResponse.json()
                throw new Error(errorData.error || 'Failed to fetch agents')
            }

            const agentsData = await agentsResponse.json()
            setAgents(agentsData || [])

        } catch (error: any) {
            console.error('Error fetching membership data:', error)
            toast.error('Failed to load data')
        } finally {
            setLoading(false)
        }
    }

    const handleSavePrices = async () => {
        setIsSavingPrices(true)
        try {
            // Convert string values to numbers for the API
            const numericPrices: Record<string, number> = {}
            for (const t of RESELLER_TIERS) {
                numericPrices[t] = parseFloat(prices[t]) || 0
            }

            const response = await fetch('/api/admin/update-prices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prices: numericPrices })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to update prices')
            }

            // Clear pricing cache so users get fresh prices
            clearPricingCache()
            toast.success('Prices updated successfully!')
            await fetchData()
        } catch (error: any) {
            console.error('Error saving prices:', error)
            toast.error(error.message)
        } finally {
            setIsSavingPrices(false)
        }
    }

    const filteredAgents = agents.filter(a =>
        a.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.last_name?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-8 pb-20">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-8 h-8 text-amber-500" />
                    Agent Memberships
                </h1>
                <p className="text-muted-foreground font-medium">Manage pricing for reseller tiers. Memberships are permanent.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Pricing Manager Card */}
                <Card className="lg:col-span-1 shadow-xl border-amber-100 h-fit">
                    <CardHeader className="bg-[hsl(var(--neon-amber)/0.12)]">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Plus className="w-5 h-5 text-amber-600" />
                            Upgrade Pricing
                        </CardTitle>
                        <CardDescription>Set the cost for each membership tier.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-6">
                        <div className="space-y-4">
                            {RESELLER_TIERS.map((tier) => (
                                <div key={tier} className="space-y-2">
                                    <Label>{roleConfig[tier].label} Upgrade Price (GHS)</Label>
                                    <Input
                                        type="number"
                                        value={prices[tier]}
                                        onChange={(e) => setPrices({ ...prices, [tier]: e.target.value })}
                                        className="font-bold text-lg"
                                    />
                                </div>
                            ))}
                        </div>
                        <Button
                            className="w-full bg-card hover:bg-accent h-12 text-base font-black"
                            onClick={handleSavePrices}
                            disabled={isSavingPrices}
                        >
                            {isSavingPrices ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                            Update Prices
                        </Button>
                    </CardContent>
                </Card>

                {/* Agents List Card */}
                <Card className="lg:col-span-2 shadow-xl border-blue-50">
                    <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b gap-4">
                        <div className="space-y-1">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Users className="w-5 h-5 text-blue-600" />
                                Active Agents ({agents.length})
                            </CardTitle>
                            <CardDescription>Agents with permanent reseller membership.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => fetchData()}>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Refresh
                            </Button>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search agents..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 h-9 text-xs"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        {loading ? (
                            <div className="flex justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                            </div>
                        ) : filteredAgents.length === 0 ? (
                            <div className="text-center py-20 space-y-4">
                                <p className="text-muted-foreground font-medium">No agents found.</p>
                            </div>
                        ) : (
                            <>
                                {/* Desktop Table View */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50 text-slate-500 font-bold">
                                            <tr>
                                                <th className="px-6 py-4 text-left">Agent</th>
                                                <th className="px-6 py-4 text-left">Tier</th>
                                                <th className="px-6 py-4 text-center">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {filteredAgents.map((agent) => (
                                                <tr key={agent.id} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col">
                                                            <span className="font-black text-slate-900">{agent.first_name} {agent.last_name}</span>
                                                            <span className="text-xs text-muted-foreground">{agent.email}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm font-semibold text-slate-700">
                                                            {isResellerRole(agent.role) ? roleConfig[agent.role as keyof typeof roleConfig]?.label ?? agent.role : agent.role}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200 uppercase text-[10px] font-black">
                                                            Active
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Card View */}
                                <div className="md:hidden space-y-4 p-4">
                                    {filteredAgents.map((agent) => (
                                        <div key={agent.id} className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-3">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h3 className="font-black text-slate-900">{agent.first_name} {agent.last_name}</h3>
                                                    <p className="text-xs text-muted-foreground">{agent.email}</p>
                                                    <p className="text-xs font-semibold text-slate-600 mt-1">
                                                        {isResellerRole(agent.role) ? roleConfig[agent.role as keyof typeof roleConfig]?.label ?? agent.role : agent.role}
                                                    </p>
                                                </div>
                                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200 uppercase text-[10px] font-black">
                                                    Active
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
