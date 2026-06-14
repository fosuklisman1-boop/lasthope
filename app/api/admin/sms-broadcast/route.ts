import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { sendSMS } from '@/lib/sms-service'

interface BroadcastRequest {
    userIds?: string[]
    roleFilter?: 'all' | 'user' | 'sub-admin'
    message: string
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdmin()
        if (auth instanceof NextResponse) return auth
        if (auth.role !== 'admin') {
            return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
        }
        const supabase = auth.supabase

        const body: BroadcastRequest = await request.json()
        const { userIds, roleFilter, message } = body

        if (!message || message.trim().length === 0) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 })
        }

        if (!userIds && !roleFilter) {
            return NextResponse.json({ error: 'Either userIds or roleFilter is required' }, { status: 400 })
        }

        // Fetch recipients based on selection
        let query = supabase
            .from('users')
            .select('id, first_name, phone_number, role')
            .not('phone_number', 'is', null)

        if (userIds && userIds.length > 0) {
            // Specific users selected
            query = query.in('id', userIds)
        } else if (roleFilter && roleFilter !== 'all') {
            // Filter by role
            query = query.eq('role', roleFilter)
        }

        const { data: recipients, error: fetchError } = await query

        if (fetchError) {
            console.error('[SMSBroadcast] Error fetching recipients:', fetchError)
            return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
        }

        if (!recipients || recipients.length === 0) {
            return NextResponse.json({ error: 'No recipients found with valid phone numbers' }, { status: 400 })
        }

        // Send SMS to recipients

        // Send SMS to each recipient
        const results = {
            total: recipients.length,
            success: 0,
            failed: 0,
            errors: [] as string[]
        }

        for (const recipient of recipients as any[]) {
            if (!recipient.phone_number) {
                results.failed++
                results.errors.push(`${recipient.first_name || 'Unknown'}: No phone number`)
                console.warn(`[SMSBroadcast] Skipping user ${recipient.first_name} - no phone number`)
                continue
            }

            try {
                const result = await sendSMS({
                    recipient: recipient.phone_number,
                    message: message.trim()
                })

                if (result.success) {
                    results.success++
                } else {
                    results.failed++
                    results.errors.push(`${recipient.first_name || 'Unknown'}: ${result.error}`)
                    console.error(`[SMSBroadcast] ❌ Failed for ${recipient.first_name}: ${result.error}`)
                }
            } catch (err: any) {
                results.failed++
                results.errors.push(`${recipient.first_name || 'Unknown'}: ${err.message}`)
                console.error(`[SMSBroadcast] ❌ Exception for ${recipient.first_name}:`, err)
            }
        }

        // SMS broadcast complete

        return NextResponse.json({
            success: true,
            results
        })
    } catch (error: any) {
        console.error('[SMSBroadcast] Error:', error)
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
    }
}
