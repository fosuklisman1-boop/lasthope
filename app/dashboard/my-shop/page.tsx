'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { 
    Store, 
    Settings, 
    Package, 
    Wallet, 
    TrendingUp, 
    ExternalLink, 
    Plus,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Copy,
    ChevronRight,
    History,
    ShoppingBag,
    RefreshCw, 
    Share2, 
    Home, 
    ArrowLeft, 
    Building2,
    Database,
    Phone,
    User
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { usePackagePrices } from '@/hooks/use-package-prices'
import { ShopBulkPricing } from '@/components/shop/shop-bulk-pricing'

interface Shop {
    id: string
    name: string
    slug: string
    description: string
    logo_url: string
    theme_color: string
    is_active: boolean
}

interface WithdrawalStats {
    totalEarnings: number
    totalWithdrawn: number
    pendingAmount: number
    availableBalance: number
}

interface Withdrawal {
    id: string
    amount: number
    status: 'pending' | 'approved' | 'rejected'
    payment_method: string
    payment_details: string
    admin_notes: string
    created_at: string
}

interface PackageConfig {
    id: string
    network: string
    size: string
    price: number
    agent_price: number
    shop_config: {
        is_enabled: boolean
        custom_price: number | null
        profit_margin: number
    }
}

interface Order {
    id: string
    customer_phone: string
    network: string
    size: string
    price: number
    profit_amount: number
    status: string
    payment_status: string
    created_at: string
}

function PriceInput({ pkg, cost, onUpdate }: { pkg: PackageConfig, cost: number, onUpdate: (value: number) => void }) {
    const [localValue, setLocalValue] = useState<string>((pkg.shop_config.custom_price || cost).toString())

    useEffect(() => {
        setLocalValue((pkg.shop_config.custom_price || cost).toString())
    }, [pkg.shop_config.custom_price, cost])

    return (
        <Input 
            className="h-7 text-xs font-bold" 
            type="number" 
            step="0.01"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={() => {
                const val = parseFloat(localValue)
                if (!isNaN(val) && val !== (pkg.shop_config.custom_price || cost)) {
                    onUpdate(val)
                }
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    const val = parseFloat(localValue)
                    if (!isNaN(val)) onUpdate(val)
                    // @ts-ignore
                    e.target.blur()
                }
            }}
        />
    )
}

export default function MyShopPage() {
    const { dbUser } = useAuth()
    const { priceFor } = usePackagePrices()
    const [shop, setShop] = useState<Shop | null>(null)
    const [stats, setStats] = useState<WithdrawalStats | null>(null)
    const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
    const [packages, setPackages] = useState<PackageConfig[]>([])
    const [orders, setOrders] = useState<Order[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    
    // Form states
    const [shopName, setShopName] = useState('')
    const [description, setDescription] = useState('')
    const [withdrawalAmount, setWithdrawalAmount] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<'MTN' | 'TELECEL' | 'AT'>('MTN')
    const [momoNumber, setMomoNumber] = useState('')
    const [momoName, setMomoName] = useState('')

    useEffect(() => {
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        setIsLoading(true)
        try {
            await Promise.all([
                fetchShop(),
                fetchWithdrawals(),
                fetchPackages(),
                fetchOrders()
            ])
        } catch (error) {
            console.error('Error fetching shop data:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const fetchShop = async () => {
        const res = await fetch('/api/user/shop')
        const data = await res.json()
        if (data.shop) {
            setShop(data.shop)
            setShopName(data.shop.name)
            setDescription(data.shop.description || '')
        }
    }

    const fetchWithdrawals = async () => {
        const res = await fetch('/api/user/withdrawals')
        const data = await res.json()
        if (data.stats) setStats(data.stats)
        if (data.withdrawals) setWithdrawals(data.withdrawals)
    }

    const fetchPackages = async () => {
        const res = await fetch('/api/user/shop/packages')
        const data = await res.json()
        if (data.packages) setPackages(data.packages)
    }

    const fetchOrders = async () => {
        const res = await fetch('/api/user/shop/orders')
        const data = await res.json()
        if (data.orders) setOrders(data.orders)
    }

    const handleCreateShop = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSaving(true)
        try {
            const res = await fetch('/api/user/shop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: shopName, description })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setShop(data.shop)
            toast.success('Shop created successfully!')
            fetchInitialData()
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleUpdateShop = async () => {
        if (!shop) return
        setIsSaving(true)
        try {
            const res = await fetch('/api/user/shop', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: shop.id, name: shopName, description })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setShop(data.shop)
            toast.success('Shop settings updated!')
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleUpdatePackage = async (pkgId: string, updates: any) => {
        try {
            const pkg = packages.find(p => p.id === pkgId)
            if (!pkg) return

            const cost = priceFor(pkg as any)
            const res = await fetch('/api/user/shop/packages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shopId: shop?.id,
                    packageId: pkgId,
                    isEnabled: updates.isEnabled !== undefined ? updates.isEnabled : pkg.shop_config.is_enabled,
                    customPrice: updates.customPrice !== undefined ? updates.customPrice : pkg.shop_config.custom_price,
                    profitMargin: updates.profitMargin !== undefined ? updates.profitMargin : (updates.customPrice !== undefined ? (updates.customPrice - cost) : pkg.shop_config.profit_margin)
                })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            
            // Optimistic update
            setPackages(packages.map(p => p.id === pkgId ? {
                ...p,
                shop_config: { ...p.shop_config, ...updates }
            } : p))
            toast.success('Package updated')
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleRequestWithdrawal = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!withdrawalAmount || Number(withdrawalAmount) <= 0) return
        setIsSaving(true)
        try {
            const res = await fetch('/api/user/withdrawals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: Number(withdrawalAmount),
                    paymentMethod,
                    paymentDetails: `Number: ${momoNumber} | Name: ${momoName}`
                })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            toast.success('Withdrawal request submitted!')
            setWithdrawalAmount('')
            fetchWithdrawals()
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const copyStorefrontLink = () => {
        if (!shop) return
        const url = `${window.location.origin}/s/${shop.slug}`
        navigator.clipboard.writeText(url)
        toast.success('Storefront link copied!')
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!shop) {
        return (
            <div className="max-w-2xl mx-auto py-12">
                <Card>
                    <CardHeader className="text-center">
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Store className="w-8 h-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl font-bold">Launch Your Storefront</CardTitle>
                        <CardDescription>
                            Create your own shop to sell data bundles and earn profit on every sale.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreateShop} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Shop Name</Label>
                                <Input 
                                    id="name" 
                                    placeholder="e.g. Flexy Data Hub" 
                                    value={shopName}
                                    onChange={(e) => setShopName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="desc">Description (Optional)</Label>
                                <Textarea 
                                    id="desc" 
                                    placeholder="Briefly describe your shop..." 
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </div>
                            <Button className="w-full" disabled={isSaving}>
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                                Create Shop
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{shop.name}</h1>
                    <p className="text-muted-foreground">Manage your storefront, pricing, and earnings.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={copyStorefrontLink}>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Link
                    </Button>
                    <Button size="sm" asChild>
                        <a href={`/s/${shop.slug}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Visit Shop
                        </a>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-primary text-primary-foreground">
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium opacity-90">Available Balance</p>
                            <Wallet className="w-4 h-4 opacity-70" />
                        </div>
                        <h2 className="text-2xl font-bold mt-2">{formatCurrency(stats?.availableBalance || 0)}</h2>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-muted-foreground">Total Earnings</p>
                            <TrendingUp className="w-4 h-4 text-emerald-500" />
                        </div>
                        <h2 className="text-2xl font-bold mt-2">{formatCurrency(stats?.totalEarnings || 0)}</h2>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-muted-foreground">Pending</p>
                            <History className="w-4 h-4 text-amber-500" />
                        </div>
                        <h2 className="text-2xl font-bold mt-2">{formatCurrency(stats?.pendingAmount || 0)}</h2>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-muted-foreground">Total Withdrawn</p>
                            <CheckCircle2 className="w-4 h-4 text-primary" />
                        </div>
                        <h2 className="text-2xl font-bold mt-2">{formatCurrency(stats?.totalWithdrawn || 0)}</h2>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="packages" className="w-full">
                <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
                    <TabsTrigger value="packages">Packages</TabsTrigger>
                    <TabsTrigger value="orders">Orders</TabsTrigger>
                    <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="space-y-4 pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Shop Orders</CardTitle>
                            <CardDescription>Monitor sales and fulfillment status from your storefront.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {orders.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-8">No orders yet.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm text-left">
                                            <thead>
                                                <tr className="border-b">
                                                    <th className="pb-3 font-semibold">Date</th>
                                                    <th className="pb-3 font-semibold">Customer</th>
                                                    <th className="pb-3 font-semibold">Bundle</th>
                                                    <th className="pb-3 font-semibold text-right">Selling Price</th>
                                                    <th className="pb-3 font-semibold text-right">Your Profit</th>
                                                    <th className="pb-3 font-semibold text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {orders.map(order => (
                                                    <tr key={order.id} className="hover:bg-muted/50 transition-colors">
                                                        <td className="py-4 text-xs text-muted-foreground">{formatDate(order.created_at)}</td>
                                                        <td className="py-4 font-mono">{order.customer_phone}</td>
                                                        <td className="py-4 font-medium">{order.network} {order.size}</td>
                                                        <td className="py-4 text-right font-bold">{formatCurrency(order.price)}</td>
                                                        <td className="py-4 text-right">
                                                            <span className="text-emerald-600 font-bold">+{formatCurrency(order.profit_amount)}</span>
                                                        </td>
                                                        <td className="py-4 text-center">
                                                            <div className="flex flex-col gap-1 items-center">
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                                    order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                                                                    order.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                                                                    order.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                                    'bg-blue-100 text-blue-800'
                                                                }`}>
                                                                    {order.status}
                                                                </span>
                                                                <span className={`text-[9px] uppercase font-medium ${order.payment_status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                                    {order.payment_status}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="packages" className="space-y-4 pt-4">
                    {shop && (
                        <ShopBulkPricing
                            shopId={shop.id}
                            packages={packages.map(p => ({ id: p.id, network: p.network, size: p.size, cost: priceFor(p as any), customPrice: p.shop_config.custom_price ? Number(p.shop_config.custom_price) : null }))}
                            onSaved={rows => setPackages(prev => prev.map(p => { const r = rows.find(x => x.package_id === p.id); return r ? { ...p, shop_config: { ...p.shop_config, custom_price: r.custom_price, profit_margin: r.profit_margin } } : p }))}
                        />
                    )}
                    <Card>
                        <CardHeader>
                            <CardTitle>Manage Shop Packages</CardTitle>
                            <CardDescription>Enable or disable products and set your own profit margins.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-6">
                                {['MTN', 'Telecel', 'AT-iShare', 'AT-BigTime'].map(network => (
                                    <div key={network} className="space-y-3">
                                        <h3 className="font-bold border-b pb-1">{network}</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {packages.filter(p => p.network === network).map(pkg => (
                                                <Card key={pkg.id} className={!pkg.shop_config.is_enabled ? 'opacity-60 bg-muted/30' : ''}>
                                                    <CardContent className="p-4 space-y-4">
                                                        <div className="flex items-center justify-between">
                                                            <span className="font-bold">{pkg.size}</span>
                                                            <Switch 
                                                                checked={pkg.shop_config.is_enabled} 
                                                                onCheckedChange={(checked) => handleUpdatePackage(pkg.id, { isEnabled: checked })}
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                                            <div>
                                                                <Label className="text-[10px] uppercase opacity-60">Your Cost</Label>
                                                                <p className="font-mono">{formatCurrency(priceFor(pkg as any))}</p>
                                                            </div>
                                                            <div>
                                                                <Label className="text-[10px] uppercase opacity-60">Selling Price</Label>
                                                                <PriceInput 
                                                                    pkg={pkg} 
                                                                    cost={priceFor(pkg as any)}
                                                                    onUpdate={(val) => handleUpdatePackage(pkg.id, { customPrice: val })}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="bg-primary/5 rounded p-2 text-center">
                                                            <Label className="text-[10px] uppercase opacity-60">Your Profit</Label>
                                                            <p className="font-bold text-emerald-600">
                                                                {formatCurrency((pkg.shop_config.custom_price || priceFor(pkg as any)) - priceFor(pkg as any))}
                                                            </p>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="withdrawals" className="space-y-4 pt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-1">
                            <CardHeader>
                                <CardTitle>Request Withdrawal</CardTitle>
                                <CardDescription>Withdraw your profit to your mobile money or bank account.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleRequestWithdrawal} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Amount (GHS)</Label>
                                        <Input 
                                            type="number" 
                                            placeholder="0.00" 
                                            value={withdrawalAmount}
                                            onChange={(e) => setWithdrawalAmount(e.target.value)}
                                            required
                                        />
                                        <p className="text-[10px] text-muted-foreground">Available: {formatCurrency(stats?.availableBalance || 0)}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Payment Network</Label>
                                        <Select 
                                            value={paymentMethod} 
                                            onValueChange={(value: any) => setPaymentMethod(value)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select Network" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="MTN">MTN MoMo</SelectItem>
                                                <SelectItem value="TELECEL">Telecel Cash</SelectItem>
                                                <SelectItem value="AT">AT Money</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>MoMo Number</Label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                                            <Input 
                                                className="pl-9"
                                                placeholder="e.g. 0244123456" 
                                                value={momoNumber}
                                                onChange={(e) => setMomoNumber(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Account Name</Label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                                            <Input 
                                                className="pl-9"
                                                placeholder="Name on MoMo account" 
                                                value={momoName}
                                                onChange={(e) => setMomoName(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <Button className="w-full" disabled={isSaving || !stats?.availableBalance || Number(withdrawalAmount) > stats.availableBalance || !!stats?.pendingAmount}>
                                        {stats?.pendingAmount ? 'Withdrawal Pending' : 'Submit Request'}
                                    </Button>
                                    {!!stats?.pendingAmount && (
                                        <p className="text-[10px] text-amber-600 font-bold text-center mt-2 flex items-center justify-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            Please wait for your current request to be processed.
                                        </p>
                                    )}
                                </form>
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle>Withdrawal History</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {withdrawals.length === 0 ? (
                                        <p className="text-center text-muted-foreground py-8">No withdrawal history yet.</p>
                                    ) : (
                                        withdrawals.map(w => (
                                            <div key={w.id} className="flex items-center justify-between p-4 border rounded-lg">
                                                <div className="space-y-1">
                                                    <p className="font-bold text-lg">{formatCurrency(w.amount)}</p>
                                                    <p className="text-xs text-muted-foreground">{formatDate(w.created_at)} • {w.payment_method}</p>
                                                </div>
                                                <div className="text-right">
                                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                                                        w.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                                                        w.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                                                        'bg-red-100 text-red-800'
                                                    }`}>
                                                        {w.status}
                                                    </span>
                                                    {w.admin_notes && <p className="text-[10px] text-muted-foreground mt-1 max-w-[200px] truncate">{w.admin_notes}</p>}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="settings" className="pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Shop Settings</CardTitle>
                            <CardDescription>Update your shop's branding and information.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Shop Name</Label>
                                <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Description</Label>
                                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                            </div>
                            <div className="pt-4 flex items-center justify-between border-t text-sm">
                                <div>
                                    <p className="font-bold">Storefront Slug</p>
                                    <p className="text-muted-foreground">/{shop.slug}</p>
                                </div>
                                <code className="bg-muted px-2 py-1 rounded text-[10px]">Unique - Auto Generated</code>
                            </div>
                            <Button className="mt-4" onClick={handleUpdateShop} disabled={isSaving}>
                                Save Changes
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
