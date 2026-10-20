import { NextResponse } from 'next/server'
import { withApiUsage } from '@/lib/api-usage'
import { requireApiKey } from '@/lib/require-api-key'

export const dynamic = 'force-dynamic'

async function handleGET(request: Request) {
  const auth = await requireApiKey(request)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ balance: auth.wallet.balance, currency: 'GHS' })
}

export const GET = withApiUsage(handleGET)
