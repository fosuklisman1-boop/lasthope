import { NextResponse } from 'next/server'
import { isPaymentMaintenance } from '@/lib/maintenance'

export const dynamic = 'force-dynamic'

// Public and read-only: lets the app hide top-up buttons while payments are paused.
export async function GET() {
    const paymentMaintenance = await isPaymentMaintenance()
    return NextResponse.json({ paymentMaintenance }, { headers: { 'Cache-Control': 'no-store' } })
}
