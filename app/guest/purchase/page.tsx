'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatCurrency, getNetworkGradient, cn, formatDate } from '@/lib/utils'
import { validateGhanaianPhone, detectNetwork } from '@/lib/phone-validation'
import { NetworkIcon } from '@/components/network-icon'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    Loader2,
    ArrowLeft,
    ShoppingCart,
    Zap,
    Shield,
    CheckCircle2,
    Search,
    Clock,
    XCircle,
    RefreshCw,
    ArrowRight
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import Image from 'next/image'

const NETWORKS = ['MTN', 'Telecel', 'AT-iShare', 'AT-BigTime'] as const

function GuestPurchaseContent() {
    const searchParams = useSearchParams()
    const router = useRouter()

    const [activeTab, setActiveTab] = useState('purchase')
    const [packages, setPackages] = useState<any[]>([])
    const [selectedNetwork, setSelectedNetwork] = useState<string>('MTN')
    const [isLoading, setIsLoading] = useState(true)
    const [selectedPackage, setSelectedPackage] = useState<any | null>(null)
    const [phoneNumber, setPhoneNumber] = useState('')
    const [email, setEmail] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)
    const [phoneError, setPhoneError] = useState('')

    // Tracking state
    const [trackRef, setTrackRef] = useState('')
    const [trackedOrder, setTrackedOrder] = useState<any>(null)
    const [isTracking, setIsTracking] = useState(false)

    useEffect(() => {
        fetchPackages()

        // Handle direct tracking from URL
        const ref = searchParams.get('ref')
        const tab = searchParams.get('tab')
        if (ref) {
            setTrackRef(ref)
            handleTrackOrder(ref)
            setActiveTab('track')
        } else if (tab === 'track') {
            setActiveTab('track')
        }
    }, [searchParams])

    const fetchPackages = async () => {
        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('data_packages')
                .select('*')
                .eq('is_available', true)
                .order('sort_order', { ascending: true })

            if (error) throw error
            setPackages(data || [])
        } catch (error: any) {
            toast.error('Failed to load packages')
        } finally {
            setIsLoading(false)
        }
    }

    const handleTrackOrder = async (ref: string) => {
        if (!ref) return
        setIsTracking(true)
        try {
            const phoneValidation = validateGhanaianPhone(ref)
            let query = supabase.from('orders').select('*')

            if (phoneValidation.isValid) {
                // Tracking by phone number - get most recent guest order
                query = query
                    .eq('phone_number', phoneValidation.normalizedNumber)
                    .is('user_id', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
            } else {
                // Tracking by reference code
                query = query.eq('reference_code', ref)
            }

            const { data, error } = await (phoneValidation.isValid ? query : query.single())

            if (error) throw error

            const order = Array.isArray(data) ? data[0] : data
            if (!order) {
                setTrackedOrder(null)
                if (ref.length > 5) toast.error('Order not found')
            } else {
                setTrackedOrder(order)
            }
        } catch (error: any) {
            setTrackedOrder(null)
            if (ref.length > 5) toast.error('Order not found')
        } finally {
            setIsTracking(false)
        }
    }

    const filteredPackages = packages.filter(pkg => pkg.network === selectedNetwork)

    const handleInitializePurchase = async () => {
        if (!selectedPackage) {
            toast.error('Please select a package')
            return
        }

        const phoneValidation = validateGhanaianPhone(phoneNumber)
        if (!phoneValidation.isValid) {
            setPhoneError(phoneValidation.error || 'Invalid phone number')
            return
        }

        if (!email || !email.includes('@')) {
            toast.error('Please enter a valid email address')
            return
        }

        // Check network match
        const detectedNet = detectNetwork(phoneNumber)
        const packageNetwork = selectedPackage.network.includes('AT') ? 'AirtelTigo' : selectedPackage.network
        if (detectedNet !== packageNetwork && selectedPackage.network !== 'AT-BigTime') {
            toast.error(`This number is for ${detectedNet}, not ${selectedPackage.network}`)
            return
        }

        setIsProcessing(true)
        try {
            const response = await fetch('/api/guest/purchase/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packageId: selectedPackage.id,
                    phoneNumber: phoneValidation.normalizedNumber,
                    email: email,
                    network: selectedPackage.network
                })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Failed to initialize purchase')

            if (data.authorization_url) {
                window.location.href = data.authorization_url
            }
        } catch (error: any) {
            toast.error(error.message)
            setIsProcessing(false)
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-10 h-10 text-green-500" />
            case 'failed': return <XCircle className="w-10 h-10 text-red-500" />
            case 'processing': return <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
            default: return <Clock className="w-10 h-10 text-yellow-500 animate-pulse" />
        }
    }

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header */}
            <header className="bg-white border-b sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center space-x-2">
                        <ArrowLeft className="w-5 h-5 text-slate-500" />
                        <span className="font-bold text-xl text-primary">LASTHOPE</span>
                    </Link>
                    <div className="flex items-center space-x-4">
                        <Link href="/auth/login">
                            <Button variant="ghost">Login</Button>
                        </Link>
                        <Link href="/auth/signup">
                            <Button className="bg-[#0056B3]">Sign Up</Button>
                        </Link>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 pt-8">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
                    <div className="flex justify-center">
                        <TabsList className="bg-white border-2 border-slate-200 p-1 h-auto rounded-2xl shadow-sm">
                            <TabsTrigger
                                value="purchase"
                                className="px-8 py-3 rounded-xl font-bold data-[state=active]:bg-[#0056B3] data-[state=active]:text-white"
                            >
                                <ShoppingCart className="w-4 h-4 mr-2" />
                                Buy Data
                            </TabsTrigger>
                            <TabsTrigger
                                value="track"
                                className="px-8 py-3 rounded-xl font-bold data-[state=active]:bg-[#0056B3] data-[state=active]:text-white"
                            >
                                <Search className="w-4 h-4 mr-2" />
                                Track Order
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="purchase" className="mt-0">
                        <div className="space-y-6">
                            <div className="space-y-6">
                                <div className="flex flex-col space-y-2">
                                    <h1 className="text-3xl font-bold text-slate-900 text-center lg:text-left">Choose Data Package</h1>
                                    <p className="text-slate-500 text-center lg:text-left">Select your network and the bundle you want to purchase.</p>
                                </div>

                                {/* Network Tabs */}
                                <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
                                    {NETWORKS.map((net) => (
                                        <button
                                            key={net}
                                            onClick={() => {
                                                setSelectedNetwork(net)
                                                setSelectedPackage(null)
                                            }}
                                            className={cn(
                                                "px-6 py-3 rounded-xl font-bold transition-all flex items-center space-x-2 border-2",
                                                selectedNetwork === net
                                                    ? "bg-white border-[#0056B3] text-primary shadow-md scale-105"
                                                    : "bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200"
                                            )}
                                        >
                                            <NetworkIcon network={net} size={24} />
                                            <span>{net}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Packages Grid */}
                                {isLoading ? (
                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {[1, 2, 3, 4].map(i => (
                                            <div key={i} className="h-32 bg-slate-200 animate-pulse rounded-2xl" />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {filteredPackages.map((pkg) => (
                                            <button
                                                key={pkg.id}
                                                onClick={() => setSelectedPackage(pkg)}
                                                className={cn(
                                                    "relative p-6 rounded-2xl text-left transition-all border-2 group",
                                                    selectedPackage?.id === pkg.id
                                                        ? "bg-white border-[#0056B3] ring-4 ring-blue-50 text-primary shadow-xl"
                                                        : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-lg"
                                                )}
                                            >
                                                <div className="flex justify-between items-start mb-4">
                                                    <div className={cn(
                                                        "w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-inner",
                                                        getNetworkGradient(pkg.network)
                                                    )}>
                                                        {pkg.size.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <Badge variant="secondary" className="font-bold">
                                                        {formatCurrency(pkg.price)}
                                                    </Badge>
                                                </div>
                                                <h3 className="text-lg font-bold text-slate-900">{pkg.size}</h3>
                                                <p className="text-sm text-slate-500 mt-1">{pkg.network} Bundle</p>

                                                {selectedPackage?.id === pkg.id && (
                                                    <div className="absolute top-4 right-4 text-primary">
                                                        <CheckCircle2 className="w-6 h-6" />
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Checkout: one modal on phone, tablet and laptop */}
                            <Dialog
                                open={!!selectedPackage}
                                onOpenChange={(open) => {
                                    if (!open && !isProcessing) {
                                        setSelectedPackage(null)
                                        setPhoneError('')
                                    }
                                }}
                            >
                                <DialogContent className="w-[calc(100%-1.5rem)] max-w-md max-h-[92vh] overflow-y-auto rounded-[1.75rem] border-t-4 border-t-primary p-5 sm:p-6">
                                    <DialogHeader className="space-y-1.5 text-left">
                                        <DialogTitle className="flex items-center gap-2 text-xl !text-left">
                                            <ShoppingCart className="w-5 h-5 text-primary" />
                                            Quick checkout
                                        </DialogTitle>
                                        <DialogDescription className="text-left">Enter the recipient's number and your email to pay.</DialogDescription>
                                    </DialogHeader>

                                    {selectedPackage && (
                                        <div className="space-y-5">
                                            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 space-y-2">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-500">Package:</span>
                                                    <span className="font-bold text-slate-900">{selectedPackage.size}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-500">Network:</span>
                                                    <span className="font-bold text-slate-900">{selectedPackage.network}</span>
                                                </div>
                                                <div className="pt-2 border-t border-blue-200 flex justify-between items-center">
                                                    <span className="font-bold text-slate-900">Total:</span>
                                                    <span className="text-xl font-black text-primary">{formatCurrency(selectedPackage.price)}</span>
                                                </div>
                                            </div>

                                            <form
                                                className="space-y-4"
                                                onSubmit={(e) => { e.preventDefault(); handleInitializePurchase() }}
                                            >
                                                <div className="space-y-2">
                                                    <Label htmlFor="phone">Recipient phone number</Label>
                                                    <Input
                                                        id="phone"
                                                        type="tel"
                                                        inputMode="tel"
                                                        autoComplete="tel"
                                                        autoFocus
                                                        placeholder="e.g. 0241234567"
                                                        value={phoneNumber}
                                                        onChange={(e) => {
                                                            setPhoneNumber(e.target.value)
                                                            setPhoneError('')
                                                        }}
                                                        className={cn(phoneError && "border-red-500 focus-visible:ring-red-500")}
                                                    />
                                                    {phoneError && <p className="text-xs text-red-500 font-medium">{phoneError}</p>}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label htmlFor="email">Your email address</Label>
                                                    <Input
                                                        id="email"
                                                        type="email"
                                                        inputMode="email"
                                                        autoComplete="email"
                                                        placeholder="for order tracking & receipt"
                                                        value={email}
                                                        onChange={(e) => setEmail(e.target.value)}
                                                    />
                                                    <p className="text-[10px] text-slate-400">We will send your order tracking link here.</p>
                                                </div>

                                                <Button
                                                    type="submit"
                                                    className="w-full h-14 bg-[#0056B3] hover:bg-[#004494] text-white font-bold text-lg rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50"
                                                    disabled={isProcessing}
                                                >
                                                    {isProcessing ? (
                                                        <>
                                                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                                            Processing...
                                                        </>
                                                    ) : (
                                                        <>Pay {formatCurrency(selectedPackage.price)} now</>
                                                    )}
                                                </Button>
                                            </form>

                                            <div className="flex items-center justify-center space-x-4 opacity-50 grayscale">
                                                <Zap className="w-5 h-5" />
                                                <Shield className="w-5 h-5" />
                                                <CheckCircle2 className="w-5 h-5" />
                                            </div>
                                        </div>
                                    )}
                                </DialogContent>
                            </Dialog>
                        </div>
                    </TabsContent>

                    <TabsContent value="track" className="mt-0">
                        <div className="max-w-2xl mx-auto space-y-6">
                            <Card className="shadow-2xl border-slate-200 overflow-hidden">
                                <div className="h-2 bg-gradient-to-r from-[#0056B3] to-[#00B4D8]" />
                                <CardHeader>
                                    <CardTitle className="text-center text-2xl font-black">Track Your Order</CardTitle>
                                    <CardDescription className="text-center">
                                        Enter your order reference code or phone number to see its current status.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    <div className="flex space-x-2">
                                        <div className="relative flex-1">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <Input
                                                className="pl-10 h-12 rounded-xl"
                                                placeholder="e.g. GST-ABC-123 or 024XXXXXXX"
                                                value={trackRef}
                                                onChange={(e) => setTrackRef(e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            className="h-12 px-6 font-bold rounded-xl bg-[#0056B3]"
                                            onClick={() => handleTrackOrder(trackRef)}
                                            disabled={isTracking}
                                        >
                                            {isTracking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Track'}
                                        </Button>
                                    </div>

                                    {trackedOrder && (
                                        <div className="mt-8 space-y-6 animate-in fade-in slide-in-from-bottom-4">
                                            <div className="flex flex-col items-center justify-center pb-4 border-b">
                                                <div className="mb-4">
                                                    {getStatusIcon(trackedOrder.status)}
                                                </div>
                                                <h3 className="text-xl font-bold text-slate-900 border-none">
                                                    {trackedOrder.status === 'completed' ? 'Order Completed' :
                                                        trackedOrder.status === 'failed' ? 'Order Failed' :
                                                            trackedOrder.status === 'processing' ? 'Delivery in Progress' : 'Pending Processing'}
                                                </h3>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-4 rounded-xl bg-slate-50 space-y-1">
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Package</p>
                                                    <p className="font-bold text-slate-900">{trackedOrder.size}</p>
                                                </div>
                                                <div className="p-4 rounded-xl bg-slate-50 space-y-1">
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Recipient</p>
                                                    <p className="font-bold text-slate-900">{trackedOrder.phone_number}</p>
                                                </div>
                                                <div className="p-4 rounded-xl bg-slate-50 space-y-1">
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Network</p>
                                                    <p className="font-bold text-slate-900">{trackedOrder.network}</p>
                                                </div>
                                                <div className="p-4 rounded-xl bg-slate-50 space-y-1">
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Date</p>
                                                    <p className="font-bold text-slate-900">{formatDate(trackedOrder.created_at)}</p>
                                                </div>
                                            </div>

                                            {trackedOrder.status === 'processing' && (
                                                <div className="bg-blue-50 text-blue-700 p-4 rounded-xl text-sm font-medium animate-pulse">
                                                    Our system is delivering your data. This usually takes less than 60 seconds.
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!trackedOrder && !isTracking && trackRef && (
                                        <div className="text-center py-8">
                                            <p className="text-slate-400">Order not found. Please check the reference code.</p>
                                        </div>
                                    )}
                                    {!trackedOrder && !isTracking && !trackRef && (
                                        <div className="text-center py-8">
                                            <p className="text-slate-400">Enter a reference to see order details.</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <div className="text-center">
                                <Link href="/auth/signup">
                                    <Button variant="link" className="text-primary font-bold">
                                        Want agent discounts? Create an account today!
                                        <ArrowRight className="ml-2 w-4 h-4" />
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    )
}

export default function GuestPurchasePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
        }>
            <GuestPurchaseContent />
        </Suspense>
    )
}
