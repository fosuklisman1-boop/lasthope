'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
    Loader2, 
    ShoppingCart, 
    Store, 
    ShieldCheck, 
    Zap,
    AlertCircle,
    CheckCircle2
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, getNetworkColor, getNetworkGradient } from '@/lib/utils'

interface Shop {
    id: string
    name: string
    description: string
    logo_url: string
    theme_color: string
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

export default function StorefrontPage() {
    const params = useParams()
    const router = useRouter()
    const [shop, setShop] = useState<Shop | null>(null)
    const [packages, setPackages] = useState<PackageConfig[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedPkg, setSelectedPkg] = useState<PackageConfig | null>(null)
    
    // Purchase states
    const [phoneNumber, setPhoneNumber] = useState('')
    const [email, setEmail] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)

    useEffect(() => {
        if (params.slug) {
            fetchShopData()
        }
    }, [params.slug])

    const fetchShopData = async () => {
        setIsLoading(true)
        try {
            // First find shop by slug (need a public API for this)
            // For now, I'll use a fetch with slug
            const res = await fetch(`/api/guest/shop?slug=${params.slug}`)
            const data = await res.json()
            
            if (data.error) throw new Error(data.error)
            
            setShop(data.shop)
            setPackages(data.packages.filter((p: any) => p.shop_config.is_enabled))
        } catch (error: any) {
            console.error('Error fetching shop:', error)
            toast.error(error.message || 'Shop not found')
        } finally {
            setIsLoading(false)
        }
    }

    const handlePurchase = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedPkg || !phoneNumber || !email) return
        
        setIsProcessing(true)
        try {
            const res = await fetch('/api/guest/purchase/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packageId: selectedPkg.id,
                    phoneNumber,
                    email,
                    shopId: shop?.id
                })
            })
            
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            
            if (data.authorization_url) {
                window.location.href = data.authorization_url
            } else {
                toast.success('Order initialized! Check your email for payment link.')
            }
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsProcessing(false)
        }
    }

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center space-y-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
                    <p className="text-muted-foreground animate-pulse">Loading storefront...</p>
                </div>
            </div>
        )
    }

    if (!shop) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
                <Card className="max-w-md w-full text-center p-8">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <CardTitle className="text-2xl mb-2">Shop Not Found</CardTitle>
                    <p className="text-muted-foreground mb-6">The shop you're looking for doesn't exist or has been deactivated.</p>
                    <Button onClick={() => router.push('/')} variant="outline" className="w-full">
                        Back to Home
                    </Button>
                </Card>
            </div>
        )
    }

    const networks = Array.from(new Set(packages.map(p => p.network)))

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            {/* Header / Branding */}
            <div 
                className="h-64 relative flex items-center justify-center text-white overflow-hidden"
                style={{ backgroundColor: shop.theme_color || '#0f172a' }}
            >
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/20 via-transparent to-transparent" />
                </div>
                <div className="relative z-10 text-center space-y-4 px-4">
                    <div className="w-20 h-20 bg-white/10 rounded-2xl backdrop-blur-md flex items-center justify-center mx-auto border border-white/20 shadow-2xl">
                        {shop.logo_url ? (
                            <Image src={shop.logo_url} alt={shop.name} width={64} height={64} className="rounded-xl" />
                        ) : (
                            <Store className="w-10 h-10" />
                        )}
                    </div>
                    <h1 className="text-4xl font-black tracking-tight drop-shadow-lg">{shop.name}</h1>
                    {shop.description && <p className="text-lg opacity-90 max-w-lg mx-auto line-clamp-2">{shop.description}</p>}
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 -mt-8 relative z-20">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Package Listing */}
                    <div className="lg:col-span-2 space-y-8">
                        {networks.map(network => (
                            <div key={network} className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className={`w-1 h-8 rounded-full ${getNetworkColor(network)}`} />
                                    <h2 className="text-xl font-bold">{network} Bundles</h2>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {packages.filter(p => p.network === network).map(pkg => {
                                        const finalPrice = pkg.shop_config.custom_price || (pkg.price + pkg.shop_config.profit_margin)
                                        const isSelected = selectedPkg?.id === pkg.id
                                        
                                        return (
                                            <Card 
                                                key={pkg.id} 
                                                className={`cursor-pointer transition-all hover:scale-[1.02] active:scale-95 border-2 ${isSelected ? 'border-primary shadow-lg ring-1 ring-primary/20' : 'border-transparent'}`}
                                                onClick={() => setSelectedPkg(pkg)}
                                            >
                                                <CardContent className="p-0 overflow-hidden">
                                                    <div className={`h-2 bg-gradient-to-r ${getNetworkGradient(network)}`} />
                                                    <div className="p-5 flex items-center justify-between">
                                                        <div>
                                                            <p className="text-sm font-medium text-muted-foreground uppercase">{network}</p>
                                                            <h3 className="text-2xl font-black tracking-tight mt-1">{pkg.size}</h3>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-2xl font-black text-primary">{formatCurrency(finalPrice)}</p>
                                                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Instant Delivery</p>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Checkout Sidebar */}
                    <div className="lg:col-span-1">
                        <Card className="sticky top-8 shadow-xl border-t-4 border-t-primary">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5 text-primary" />
                                    Complete Order
                                </CardTitle>
                                <CardDescription>Enter your details to receive your bundle.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {selectedPkg ? (
                                    <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium opacity-70">Selected Package</span>
                                            <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase">{selectedPkg.network}</span>
                                        </div>
                                        <p className="text-xl font-black">{selectedPkg.size}</p>
                                        <div className="flex items-center justify-between pt-2 border-t mt-2">
                                            <span className="text-sm">Total Amount</span>
                                            <span className="text-xl font-black text-primary">
                                                {formatCurrency(selectedPkg.shop_config.custom_price || (selectedPkg.price + selectedPkg.shop_config.profit_margin))}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-8 border-2 border-dashed rounded-xl text-center space-y-2 opacity-50">
                                        <Zap className="w-8 h-8 mx-auto mb-2" />
                                        <p className="text-sm font-medium">Select a data bundle to begin</p>
                                    </div>
                                )}

                                <form onSubmit={handlePurchase} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="phone">Phone Number (Data Receiver)</Label>
                                        <Input 
                                            id="phone" 
                                            placeholder="e.g. 0244123456" 
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            required
                                            disabled={!selectedPkg}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="email">Email Address</Label>
                                        <Input 
                                            id="email" 
                                            type="email" 
                                            placeholder="your@email.com" 
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            disabled={!selectedPkg}
                                        />
                                    </div>
                                    
                                    <div className="pt-4 space-y-3">
                                        <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg text-[11px] font-medium flex gap-2">
                                            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                                            <span>Secure fast payment via Paystack. Bundle will be sent instantly after payment.</span>
                                        </div>
                                        <Button 
                                            className="w-full h-12 text-lg font-bold shadow-lg" 
                                            disabled={!selectedPkg || isProcessing}
                                        >
                                            {isProcessing ? (
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                            ) : (
                                                `Buy Now • ${selectedPkg ? formatCurrency(selectedPkg.shop_config.custom_price || (selectedPkg.price + selectedPkg.shop_config.profit_margin)) : ''}`
                                            )}
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>

                        <div className="mt-8 text-center space-y-4">
                            <div className="flex items-center justify-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                <span>Powered by</span>
                                <span className="text-primary tracking-tight">MDataGH</span>
                            </div>
                            <div className="flex items-center justify-center gap-4 text-muted-foreground opacity-50 grayscale contrast-125">
                                <span className="text-xs font-bold">MTN</span>
                                <span className="text-xs font-bold">TELECEL</span>
                                <span className="text-xs font-bold">AT</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
