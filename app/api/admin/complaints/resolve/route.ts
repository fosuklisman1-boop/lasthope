import { requireAdmin } from '@/lib/require-admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        const supabase = auth.supabase

        const body = await request.json()
        const { id, status, resolution_notes } = body

        if (!id || !status) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            )
        }

        // Derive user_id/order_ref from the complaint row itself, not the request body
        const { data: complaint, error: fetchError } = await (supabase
            .from('complaints') as any)
            .select('user_id, order_id, orders(reference_code)')
            .eq('id', id)
            .single()

        if (fetchError || !complaint) {
            return NextResponse.json({ error: 'Complaint not found' }, { status: 404 })
        }

        const user_id = complaint.user_id
        const order_ref = complaint.orders?.reference_code

        // Update complaint
        const { error: updateError } = await (supabase
            .from('complaints') as any)
            .update({
                status,
                resolution_notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)

        if (updateError) throw updateError

        // Create notification
        if (user_id) {
            const { error: notifyError } = await (supabase
                .from('notifications') as any)
                .insert({
                    user_id,
                    title: `Complaint ${status === 'resolved' ? 'Resolved' : 'Rejected'}`,
                    message: `Your complaint regarding order ${order_ref} has been ${status}.`,
                    type: 'complaint_resolved',
                    action_url: '/dashboard/complaints'
                })

            if (notifyError) {
                console.error('Error creating notification:', notifyError)
            }
        }

        // Send email notification
        try {
            if (user_id) {
                const { data: userData } = await (supabase
                    .from('users') as any)
                    .select('email, first_name')
                    .eq('id', user_id)
                    .single()

                if (userData?.email) {
                    const { sendComplaintResolvedEmail } = await import('@/lib/email-service')
                    await sendComplaintResolvedEmail(
                        userData.email,
                        userData.first_name || 'User',
                        {
                            orderRef: order_ref,
                            status,
                            resolutionNotes: resolution_notes || ''
                        }
                    )
                }
            }
        } catch (emailError) {
            console.error('Failed to send resolution email:', emailError)
            // Don't fail the request
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Error resolving complaint:', error)
        return NextResponse.json(
            { error: error?.message || 'Failed to resolve complaint' },
            { status: 500 }
        )
    }
}
