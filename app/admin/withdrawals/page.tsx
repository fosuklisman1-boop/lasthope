'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { 
    CheckCircle2, 
    XCircle, 
    Clock, 
    Wallet, 
    User, 
    Mail, 
    Phone,
    Loader2,
    Search,
    Filter,
    AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Withdrawal {
    id: string
    user_id: string
    amount: number
    status: 'pending' | 'approved' | 'rejected'
    payment_method: string
    payment_details: string
    admin_notes: string
    created_at: string
    users: {
        first_name: string
        last_name: string
        email: string
        phone_number: string
    }
}

export default function AdminWithdrawalsPage() {
    const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [filterStatus, setFilterStatus] = useState<string>('pending')
    const [searchTerm, setSearchTerm] = useState('')
    const [selectedWithdrawal, setSelectedWithdrawal] = useState<Withdrawal | null>(null)
    const [adminNotes, setAdminNotes] = useState('')
    const [isProcessing, setIsProcessing] = useState(false)

    useEffect(() => {
        fetchWithdrawals()
    }, [filterStatus])

    const fetchWithdrawals = async () => {
        setIsLoading(true)
        try {
            const url = filterStatus ? `/api/admin/withdrawals?status=${filterStatus}` : '/api/admin/withdrawals'
            const res = await fetch(url)
            const data = await res.json()
            console.log('[AdminWithdrawals] Received data:', {
                count: data.withdrawals?.length,
                fullData: data,
                status: res.status
            })
            if (data.withdrawals) setWithdrawals(data.withdrawals)
            if (data.error) {
                console.error('[AdminWithdrawals] API Error:', data.error, data.details)
                toast.error(`API Error: ${data.error}`)
            }
        } catch (error) {
            console.error('Error fetching withdrawals:', error)
            toast.error('Failed to load withdrawals - Check console for details')
        } finally {
            setIsLoading(false)
        }
    }

    const handleUpdateStatus = async (id: string, status: 'approved' | 'rejected') => {
        setIsProcessing(true)
        try {
            const res = await fetch('/api/admin/withdrawals', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status, adminNotes })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            
            toast.success(`Withdrawal ${status} successfully`)
            setSelectedWithdrawal(null)
            setAdminNotes('')
            fetchWithdrawals()
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsProcessing(false)
        }
    }

    const filteredWithdrawals = withdrawals.filter(w => {
        if (!searchTerm) return true
        const s = searchTerm.toLowerCase()
        return (
            (w.users?.first_name?.toLowerCase() || '').includes(s) ||
            (w.users?.last_name?.toLowerCase() || '').includes(s) ||
            (w.users?.email?.toLowerCase() || '').includes(s) ||
            (w.user_id?.toLowerCase() || '').includes(s)
        )
    })

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Withdrawal Requests</h1>
                <p className="text-muted-foreground">Manage and approve user earnings withdrawals.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search by name or email..." 
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-muted-foreground" />
                    <select 
                        className="bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                    >
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="">All</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                    ) : filteredWithdrawals.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center text-muted-foreground">
                                No withdrawal requests found matching your filter.
                            </CardContent>
                        </Card>
                    ) : (
                        filteredWithdrawals.map(w => (
                            <Card 
                                key={w.id} 
                                className={`cursor-pointer transition-all hover:border-primary/50 ${selectedWithdrawal?.id === w.id ? 'border-primary ring-1 ring-primary' : ''}`}
                                onClick={() => setSelectedWithdrawal(w)}
                            >
                                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                                            <Wallet className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-lg">{formatCurrency(w.amount)}</p>
                                            <p className="text-sm font-medium">
                                                {w.users ? `${w.users.first_name || ''} ${w.users.last_name || ''}` : `User ID: ${w.user_id.substring(0, 8)}...`}
                                            </p>
                                            <p className="text-xs text-muted-foreground">{formatDate(w.created_at)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                                            w.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                                            w.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                                            'bg-red-100 text-red-800'
                                        }`}>
                                            {w.status}
                                        </span>
                                        <Button variant="ghost" size="sm">Details</Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                <div className="lg:col-span-1">
                    {selectedWithdrawal ? (
                        <Card className="sticky top-6">
                            <CardHeader>
                                <CardTitle>Request Details</CardTitle>
                                <CardDescription>Review user info and payment details.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <User className="w-4 h-4 mt-1 text-muted-foreground" />
                                        <div>
                                            <p className="text-sm font-bold">
                                                {selectedWithdrawal.users 
                                                    ? `${selectedWithdrawal.users.first_name} ${selectedWithdrawal.users.last_name}`
                                                    : 'Profile Data Missing'}
                                            </p>
                                            <p className="text-xs text-muted-foreground">User ID: {selectedWithdrawal.user_id}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Mail className="w-4 h-4 mt-1 text-muted-foreground" />
                                        <p className="text-sm">{selectedWithdrawal.users?.email}</p>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Phone className="w-4 h-4 mt-1 text-muted-foreground" />
                                        <p className="text-sm">{selectedWithdrawal.users?.phone_number}</p>
                                    </div>
                                </div>

                                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                                    <p className="text-xs font-bold uppercase text-muted-foreground">Payment Method</p>
                                    <p className="text-sm font-bold">{selectedWithdrawal.payment_method}</p>
                                    <p className="text-xs font-bold uppercase text-muted-foreground mt-2">Account Details</p>
                                    <p className="text-sm bg-background p-2 rounded border font-mono whitespace-pre-wrap">
                                        {selectedWithdrawal.payment_details}
                                    </p>
                                </div>

                                {selectedWithdrawal.status === 'pending' && (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Label>Admin Notes / Rejection Reason</Label>
                                            <Textarea 
                                                placeholder="Add a note (optional)..." 
                                                value={adminNotes}
                                                onChange={(e) => setAdminNotes(e.target.value)}
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <Button 
                                                variant="outline" 
                                                className="border-red-500 text-red-500 hover:bg-red-50"
                                                onClick={() => handleUpdateStatus(selectedWithdrawal.id, 'rejected')}
                                                disabled={isProcessing}
                                            >
                                                <XCircle className="w-4 h-4 mr-2" />
                                                Reject
                                            </Button>
                                            <Button 
                                                className="bg-emerald-600 hover:bg-emerald-700"
                                                onClick={() => handleUpdateStatus(selectedWithdrawal.id, 'approved')}
                                                disabled={isProcessing}
                                            >
                                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                                Approve
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {selectedWithdrawal.status !== 'pending' && (
                                    <div className={`p-4 rounded-lg flex items-center gap-3 ${
                                        selectedWithdrawal.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                                    }`}>
                                        {selectedWithdrawal.status === 'approved' ? (
                                            <CheckCircle2 className="w-5 h-5" />
                                        ) : (
                                            <XCircle className="w-5 h-5" />
                                        )}
                                        <p className="text-sm font-bold">This request has been {selectedWithdrawal.status}.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="h-full flex items-center justify-center p-12 text-center text-muted-foreground">
                            <div>
                                <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>Select a withdrawal request to view details and take action.</p>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    )
}
