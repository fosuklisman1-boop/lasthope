import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ balance: auth.wallet.balance, currency: 'GHS' })
}
