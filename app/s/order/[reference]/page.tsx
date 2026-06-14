'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
    Package, 
    Phone, 
    CreditCard, 
    Clock, 
    CheckCircle2, 
    AlertCircle, 
    Loader2, 
    RefreshCcw,
    ChevronLeft,
    Share2
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

interface Order {
    reference: string
    network: string
    size: string
    amount: number
    status: string
    payment_status: string
    phone_number: string
    created_at: string
    shop_name: string
}

export default function OrderSummaryPage() {
    const params = useParams()
    const router = useRouter()
    const reference = params.reference as string
    
    const [order, setOrder] = useState<Order | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)

    useEffect(() => {
        fetchOrder()
        
        // Auto-refresh every 15 seconds if pending/processing
        const interval = setInterval(() => {
            if (order && (order.status === 'pending' || order.status === 'processing' || order.status === 'pending_download' || order.status === 'downloading')) {
                fetchOrder(true)
            }
        }, 15000)

        return () => clearInterval(interval)
    }, [reference])

    const fetchOrder = async (isAuto = false) => {
        if (!isAuto) setIsLoading(true)
        else setIsRefreshing(true)
        
        try {
            const res = await fetch(`/api/guest/order/${reference}`)
            const data = await res.json()
            if (data.order) {
                setOrder(data.order)
            } else {
                toast.error('Order not found')
            }
        } catch (error) {
            console.error('Error fetching order:', error)
        } finally {
            setIsLoading(false)
            setIsRefreshing(false)
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-emerald-100 text-emerald-800'
            case 'failed': return 'bg-red-100 text-red-800'
            case 'processing': 
            case 'downloading':
            case 'pending_download': return 'bg-blue-100 text-blue-800'
            default: return 'bg-amber-100 text-amber-800'
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            case 'failed': return <AlertCircle className="w-5 h-5 text-red-600" />
            case 'processing': 
            case 'downloading':
            case 'pending_download': return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            default: return <Clock className="w-5 h-5 text-amber-600" />
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-50">
                <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground animate-pulse">Loading order details...</p>
            </div>
        )
    }

    if (!order) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-slate-50">
                <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
                <h1 className="text-2xl font-bold">Order Not Found</h1>
                <p className="text-muted-foreground mt-2">We couldn't find an order with this reference.</p>
                <Button className="mt-6" onClick={() => router.back()}>
                    Go Back
                </Button>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 md:px-6">
            <div className="max-w-xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={() => router.back()}>
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Back
                    </Button>
                    <div className="text-right">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground">Order Ref</p>
                        <p className="font-mono text-sm">{order.reference}</p>
                    </div>
                </div>

                <Card className="border-t-4 border-t-primary shadow-lg">
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                            {getStatusIcon(order.status)}
                        </div>
                        <CardTitle className="text-2xl font-bold uppercase tracking-tight">
                            Order {order.status}
                        </CardTitle>
                        <CardDescription>
                            From {order.shop_name}
                        </CardDescription>
                        <div className="flex justify-center mt-2">
                            <span className={`px-4 py-1 rounded-full text-xs font-bold uppercase ${getStatusColor(order.status)}`}>
                                {order.status}
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="grid grid-cols-2 gap-4 pb-6 border-b">
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground flex items-center">
                                    <Package className="w-3 h-3 mr-1" /> Bundle
                                </p>
                                <p className="font-bold">{order.network} {order.size}</p>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-xs text-muted-foreground flex items-center justify-end">
                                    <Phone className="w-3 h-3 mr-1" /> Recipient
                                </p>
                                <p className="font-bold">{order.phone_number}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground flex items-center">
                                    <CreditCard className="w-3 h-3 mr-1" /> Amount Paid
                                </p>
                                <p className="font-bold">{formatCurrency(order.amount)}</p>
                            </div>
                            <div className="space-y-1 text-right">
                                <p className="text-xs text-muted-foreground flex items-center justify-end">
                                    <Clock className="w-3 h-3 mr-1" /> Date
                                </p>
                                <p className="font-medium text-xs">{formatDate(order.created_at)}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-slate-100 border border-slate-200">
                                <h4 className="text-sm font-bold mb-2 flex items-center">
                                    <RefreshCcw className={`w-3 h-3 mr-2 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
                                    Live Status
                                </h4>
                                {order.status === 'completed' ? (
                                    <p className="text-sm text-emerald-700">
                                        Your bundle has been successfully delivered! Thank you for choosing {order.shop_name}.
                                    </p>
                                ) : order.status === 'failed' ? (
                                    <p className="text-sm text-red-700">
                                        Something went wrong during fulfillment. Please contact support with your order reference.
                                    </p>
                                ) : (
                                    <p className="text-sm text-blue-700 animate-pulse">
                                        We are currently processing your order. This page will update automatically once completed.
                                    </p>
                                )}
                            </div>

                            <Button 
                                variant="outline" 
                                className="w-full" 
                                onClick={() => fetchOrder()}
                                disabled={isRefreshing}
                            >
                                {isRefreshing ? (
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                ) : (
                                    <RefreshCcw className="w-4 h-4 mr-2" />
                                )}
                                Refresh Status
                            </Button>

                            <Button 
                                className="w-full"
                                onClick={() => {
                                    if (navigator.share) {
                                        navigator.share({
                                            title: `Order Summary - ${order.reference}`,
                                            text: `Check my order status for ${order.network} ${order.size}`,
                                            url: window.location.href
                                        })
                                    } else {
                                        navigator.clipboard.writeText(window.location.href)
                                        toast.success('Link copied to clipboard')
                                    }
                                }}
                            >
                                <Share2 className="w-4 h-4 mr-2" />
                                Share Order Link
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <p className="text-center text-[10px] text-muted-foreground uppercase tracking-widest">
                    Powered by GHData Global
                </p>
            </div>
        </div>
    )
}
