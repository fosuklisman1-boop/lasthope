import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'

const ALLOWED_ROLES = ['admin', 'sub-admin', 'agent', 'super-agent', 'premium-agent', 'dealer', 'user']

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const supabase = auth.supabase

    const { userId, role } = await request.json()
    if (!userId || !role) return NextResponse.json({ error: 'userId and role are required' }, { status: 400 })
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    const { error } = await (supabase.from('users') as any)
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw error

    return NextResponse.json({ success: true, userId, newRole: role })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
