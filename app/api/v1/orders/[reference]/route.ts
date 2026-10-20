import { NextResponse } from 'next/server'
import { withApiUsage } from '@/lib/api-usage'
import { requireApiKey } from '@/lib/require-api-key'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  const { reference } = await params
  const { data, error } = await (auth.supabase.from('orders') as any)
    .select('reference_code, status, payment_status, network, size, phone_number, price, created_at')
    .eq('user_id', auth.user.id).eq('reference_code', reference).maybeSingle()
  if (error) return NextResponse.json({ error: 'Lookup failed', code: 'server_error' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Order not found', code: 'not_found' }, { status: 404 })
  return NextResponse.json({
    reference: data.reference_code, status: data.status, payment_status: data.payment_status,
    network: data.network, size: data.size, phone_number: data.phone_number, price: Number(data.price), created_at: data.created_at,
  })
}

export const GET = withApiUsage(handleGET)
