import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabaseService = auth.supabase

        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status')

        let query = supabaseService
            .from('withdrawals')
            .select('*')
            .order('created_at', { ascending: false })

        if (status) {
            query = query.eq('status', status)
        }

        const { data: withdrawals, error: wError } = await query

        if (wError) {
            console.error('[AdminWithdrawalsFetch] Error:', wError)
            return NextResponse.json({ 
                error: wError.message,
                details: wError.details,
                hint: wError.hint
            }, { status: 500 })
        }

        // Manual join to avoid relationship cache issues
        if (withdrawals && withdrawals.length > 0) {
            const userIds = [...new Set(withdrawals.map((w: any) => w.user_id))]
            const { data: users } = await supabaseService
                .from('users')
                .select('id, first_name, last_name, email, phone_number')
                .in('id', userIds)
            
            const userMap = (users || []).reduce((acc: any, u: any) => {
                acc[u.id] = u
                return acc
            }, {})

            withdrawals.forEach((w: any) => {
                w.users = userMap[w.user_id] || null
            })
        }

        return NextResponse.json({ 
            withdrawals: withdrawals || [],
            technical_note: 'Manual data aggregation applied to bypass join errors'
        })
    } catch (error: any) {
        console.error('[AdminWithdrawalsFetch] Critical Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabaseService = auth.supabase

        const body = await request.json()
        const { id, status, adminNotes } = body

        if (!id || !status) {
            return NextResponse.json({ error: 'ID and Status are required' }, { status: 400 })
        }

        if (!['approved', 'rejected'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }

        const { data, error } = await supabaseService
            .from('withdrawals')
            .update({
                status,
                admin_notes: adminNotes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        // If approved, you might want to create a notification for the user
        if (status === 'approved' || status === 'rejected') {
            await supabaseService.from('notifications').insert({
                user_id: data.user_id,
                title: `Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                message: status === 'approved' 
                    ? `Your withdrawal request for GHS ${data.amount} has been approved.`
                    : `Your withdrawal request for GHS ${data.amount} has been rejected. Note: ${adminNotes || 'No reason provided.'}`,
                type: 'payment_success', // or a more suitable type
                action_url: '/dashboard/my-shop'
            })
        }

        return NextResponse.json({ success: true, withdrawal: data })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
