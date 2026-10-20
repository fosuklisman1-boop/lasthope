import type { AdminAuth } from '@/lib/require-admin'

/** Every kind of admin action we record. Keep this list in sync with the audit-log page filters. */
export const AUDIT_ACTIONS = [
    'wallet.adjust',
    'payment.reconcile',
    'order.refund',
    'order.status',
    'order.batch',
    'order.delete_failed',
    'user.role',
    'user.status',
    'user.delete',
    'user.note',
    'prices.update',
    'package.create',
    'package.update',
    'package.delete',
    'api_key.approve',
    'api_key.revoke',
    'api_key.limit',
    'webhook.manage',
    'withdrawal.update',
    'complaint.resolve',
    'settings.update',
    'sms.broadcast',
    'announcement.post',
    'system.maintenance',
    'security.2fa',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
    action: AuditAction
    targetType?: string
    targetId?: string
    /** One plain-language sentence a human can read in the log. */
    summary: string
    /** Structured before/after values, amounts, counts. Never put secrets here. */
    details?: Record<string, unknown>
    /** Required by money-moving actions; shown in the log. */
    reason?: string
}

export interface AuditRow {
    actor_id: string | null
    actor_email: string | null
    actor_role: string | null
    action: AuditAction
    target_type: string | null
    target_id: string | null
    summary: string
    details: Record<string, unknown>
    reason: string | null
    ip: string | null
}

const MAX_SUMMARY = 300
const MAX_REASON = 500

/** First address in X-Forwarded-For, which is the original client behind Vercel's proxy. */
export function clientIp(request?: Request): string | null {
    const fwd = request?.headers.get('x-forwarded-for')
    if (!fwd) return null
    return fwd.split(',')[0].trim() || null
}

/** Pure: shape the row we store. Trims long text and drops undefined fields. */
export function buildAuditRow(
    actor: { userId: string; role: string; email?: string | null },
    entry: AuditEntry,
    ip: string | null = null
): AuditRow {
    return {
        actor_id: actor.userId,
        actor_email: actor.email ?? null,
        actor_role: actor.role,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        summary: entry.summary.slice(0, MAX_SUMMARY),
        details: JSON.parse(JSON.stringify(entry.details ?? {})),
        reason: entry.reason ? entry.reason.slice(0, MAX_REASON) : null,
        ip,
    }
}

/**
 * Record an admin action. Never throws: an audit failure must not undo or block
 * the action that already happened, but it is logged loudly so it gets noticed.
 */
export async function logAudit(auth: AdminAuth, entry: AuditEntry, request?: Request): Promise<void> {
    try {
        const { data: actor } = await auth.supabase
            .from('users')
            .select('email')
            .eq('id', auth.userId)
            .single()

        const row = buildAuditRow(
            { userId: auth.userId, role: auth.role, email: (actor as any)?.email ?? null },
            entry,
            clientIp(request)
        )
        const { error } = await (auth.supabase as any).from('audit_log').insert(row)
        if (error) console.error('[audit] insert failed:', error.message, 'action=', entry.action)
    } catch (e: any) {
        console.error('[audit] unexpected failure:', e?.message, 'action=', entry.action)
    }
}
