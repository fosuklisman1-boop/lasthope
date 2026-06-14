'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Clock, XCircle, RefreshCw, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function GuestOrderStatusPage() {
    const params = useParams()
    const reference = params.reference as string
    const [order, setOrder] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchOrder()
        const interval = setInterval(fetchOrder, 10000) // Poll every 10s
        return () => clearInterval(interval)
    }, [reference])

    const fetchOrder = async () => {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('reference_code', reference)
                .single()

            if (error) throw error
            setOrder(data)
        } catch (error) {
            console.error('Fetch order error:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-[#0056B3]" />
            </div>
        )
    }

    if (!order) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
                <XCircle className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Order Not Found</h1>
                <p className="text-slate-500 mb-8">We couldn't find any order with the provided reference.</p>
                <Link href="/">
                    <Button>Back to Home</Button>
                </Link>
            </div>
        )
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-12 h-12 text-green-500" />
            case 'failed': return <XCircle className="w-12 h-12 text-red-500" />
            case 'processing': return <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
            default: return <Clock className="w-12 h-12 text-yellow-500 animate-pulse" />
        }
    }

    const getStatusText = (status: string) => {
        switch (status) {
            case 'completed': return 'Order Completed'
            case 'failed': return 'Order Failed'
            case 'processing': return 'Delivery in Progress'
            default: return 'Pending Payment/Processing'
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <Card className="max-w-md w-full shadow-2xl overflow-hidden border-slate-200">
                <div className="h-2 bg-gradient-to-r from-[#0056B3] to-[#00B4D8]" />
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-4">
                        {getStatusIcon(order.status)}
                    </div>
                    <CardTitle className="text-2xl font-black text-slate-900">
                        {getStatusText(order.status)}
                    </CardTitle>
                    <p className="text-sm text-slate-500">Ref: {reference}</p>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-inner space-y-4">
                        <div className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                            <span className="text-slate-500 text-xs uppercase font-bold tracking-wider">Package</span>
                            <span className="font-bold text-slate-900">{order.size}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                            <span className="text-slate-500 text-xs uppercase font-bold tracking-wider">Network</span>
                            <Badge variant="outline" className="font-bold">{order.network}</Badge>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-slate-50 pb-2">
                            <span className="text-slate-500 text-xs uppercase font-bold tracking-wider">Recipient</span>
                            <span className="font-mono font-bold text-slate-900">{order.phone_number}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2">
                            <span className="text-slate-500 text-xs uppercase font-bold tracking-wider">Amount</span>
                            <div className="text-right">
                                <span className="block text-xl font-black text-[#0056B3]">{formatCurrency(order.price)}</span>
                                <Badge variant={order.payment_status === 'paid' ? 'default' : 'destructive'} className="mt-1">
                                    {order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <div className="text-center space-y-2">
                        <p className="text-sm text-slate-500">
                            Ordered on {formatDate(order.created_at)}
                        </p>
                        {order.status === 'processing' && (
                            <p className="text-xs text-blue-600 bg-blue-50 py-2 rounded-lg font-medium px-4 animate-pulse">
                                Optimization: Our system is currently delivering your data. This usually takes less than 60 seconds.
                            </p>
                        )}
                        {order.status === 'completed' && (
                            <p className="text-xs text-green-600 bg-green-50 py-2 rounded-lg font-medium px-4">
                                Great! Your data has been delivered to {order.phone_number}.
                            </p>
                        )}
                    </div>

                    <div className="pt-4 space-y-3">
                        <Link href="/">
                            <Button variant="outline" className="w-full h-12 font-bold">
                                Back to Homepage
                            </Button>
                        </Link>
                        <Link href="/auth/signup">
                            <Button className="w-full h-12 bg-[#FACC15] text-slate-900 hover:bg-[#FACC15]/90 font-bold">
                                Create Account for Discounts
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
