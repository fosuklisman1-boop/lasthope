// I/O half of the pending-payments sweep. All collaborators are injected so it can be
// tested with fakes; the cron route wires in the real ones.
import type { verifyTransaction as VerifyFn } from '@/lib/paystack-charge'
import type { PayPurpose } from './errors'
import {
  sweepTarget, sweepDecision, classifyVerifyError, mergeSweepMetadata,
  SWEEP_MIN_AGE_MS, SWEEP_BATCH, type VerifyOutcome, type SweepDecision,
} from './sweep'

/** Stop starting new rows after this long so the run finishes inside the function limit. */
export const SWEEP_TIME_BUDGET_MS = 40_000

type Completion = (reference: string, providerData: any, sb?: any) => Promise<{ success: boolean; error?: string; pending?: boolean }>

export interface SweepDeps {
  verify: typeof VerifyFn
  complete: Record<PayPurpose, Completion>
  now?: () => number
}

export interface SweepSummary { processed: number; completed: number; failed: number; left: number; skipped: number }

async function check(deps: SweepDeps, reference: string): Promise<{ outcome: VerifyOutcome; data?: any }> {
  try {
    const v = await deps.verify(reference)
    const status = typeof v.data?.status === 'string' ? v.data.status : undefined
    return { outcome: { kind: 'status', status, amountKobo: v.amountKobo }, data: v.data }
  } catch (e) {
    return { outcome: classifyVerifyError(e) }
  }
}

const statusOf = (o: VerifyOutcome) => (o.kind === 'status' ? o.status : o.kind)

export async function runSweep(sb: any, deps: SweepDeps): Promise<SweepSummary> {
  const now = deps.now ?? Date.now
  const started = now()
  const cutoff = new Date(started - SWEEP_MIN_AGE_MS).toISOString()
  const sum: SweepSummary = { processed: 0, completed: 0, failed: 0, left: 0, skipped: 0 }

  // Oldest-checked first: every visit touches updated_at, so rows that stay pending
  // rotate to the back instead of starving newer ones.
  const { data: payments, error: pErr } = await sb
    .from('wallet_payments')
    .select('id, reference, metadata, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(SWEEP_BATCH)
  if (pErr) throw new Error(`wallet_payments read failed: ${pErr.code ?? 'unknown'}`)

  const { data: orders, error: oErr } = await sb
    .from('orders')
    .select('id, reference, payment_metadata, created_at')
    .eq('status', 'pending')
    .eq('payment_status', 'unpaid')
    .like('reference', 'GST-%')
    .lt('created_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(SWEEP_BATCH)
  if (oErr) throw new Error(`orders read failed: ${oErr.code ?? 'unknown'}`)

  const rows = [
    ...(payments ?? []).map((r: any) => ({ table: 'wallet_payments' as const, id: r.id, reference: r.reference, metadata: r.metadata, createdAt: r.created_at })),
    ...(orders ?? []).map((r: any) => ({ table: 'orders' as const, id: r.id, reference: r.reference, metadata: r.payment_metadata, createdAt: r.created_at })),
  ]

  for (const row of rows) {
    if (typeof row.reference !== 'string' || !row.reference) continue
    if (now() - started > SWEEP_TIME_BUDGET_MS) { sum.skipped++; continue }
    sum.processed++
    const { outcome, data } = await check(deps, row.reference)
    const ageMs = now() - new Date(row.createdAt).getTime()
    let decision: SweepDecision = sweepDecision(outcome, Number.isFinite(ageMs) ? ageMs : 0)

    if (decision === 'complete' && outcome.kind === 'status') {
      const purpose = row.table === 'orders' ? 'storefront' : sweepTarget(row.reference, row.metadata)
      const providerData = { ...(data ?? {}), amount: outcome.amountKobo }
      try {
        const r = await deps.complete[purpose](row.reference, providerData, sb)
        if (r.success && !r.pending) { sum.completed++; continue }
        if (!r.success) console.error(`[sweep] completion failed for ${row.reference}: ${r.error}`)
      } catch (e: any) {
        console.error(`[sweep] completion threw for ${row.reference}:`, e?.name ?? 'unknown')
      }
      decision = 'leave'
    }

    const meta = mergeSweepMetadata(row.metadata, statusOf(outcome), decision, new Date(now()))
    const stamp = new Date(now()).toISOString()
    let patch: Record<string, unknown>
    if (row.table === 'orders') {
      patch = decision === 'mark_failed'
        ? { payment_status: 'failed', payment_metadata: meta, updated_at: stamp }
        : { payment_metadata: meta, updated_at: stamp }
    } else {
      patch = decision === 'mark_failed'
        ? { status: 'failed', metadata: meta, updated_at: stamp }
        : { metadata: meta, updated_at: stamp }
    }
    // Conditional on still-pending: never clobber a row a webhook/poll completed meanwhile.
    const { error: uErr } = await sb.from(row.table).update(patch).eq('id', row.id).eq('status', 'pending')
    if (uErr) console.error(`[sweep] could not update ${row.table} ${row.id}:`, uErr.code ?? 'unknown')
    if (decision === 'mark_failed') sum.failed++
    else sum.left++
  }
  return sum
}
