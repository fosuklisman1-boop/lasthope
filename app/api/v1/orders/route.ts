import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { placeOrder } from '@/lib/orders'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  if (request.headers.get('content-type')?.includes('application/json') !== true)
    return NextResponse.json({ error: 'Content-Type must be application/json', code: 'bad_content_type' }, { status: 400 })
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_body' }, { status: 400 }) }
  const { package_id, phone_number, idempotency_key } = body || {}
  const result = await placeOrder({ userId: auth.user.id, packageId: package_id, phoneNumber: phone_number, idempotencyKey: idempotency_key, source: 'api' }, auth.supabase)
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.httpStatus })
  return NextResponse.json({ reference: result.reference, status: result.status, price: result.price, network: result.network, size: result.size, currency: 'GHS' }, { status: 201 })
}
