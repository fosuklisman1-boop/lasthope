// Decision rules for the verify-pending-payments sweep (app/api/cron/verify-pending-payments).
// Pure: the route does the I/O, this module decides what to do with each row.
import { PaystackChargeError } from '@/lib/paystack-charge'
import type { PayPurpose } from './errors'
import { purposeFromReference } from './purpose'

/** Rows younger than this are left to the live /status poll and the webhook. */
export const SWEEP_MIN_AGE_MS = 5 * 60 * 1000
/** A row Paystack never saw (or abandoned) is marked failed only after this long. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000
/** Rows per table per run (oldest-checked first, so no row can starve the rest). */
export const SWEEP_BATCH = 20

export type VerifyOutcome =
  | { kind: 'status'; status: string | undefined; amountKobo?: number }
  | { kind: 'not_found' }
  | { kind: 'error' }

export type SweepDecision = 'complete' | 'mark_failed' | 'leave'

/** Completion function for a reference: DBY- must run the direct-buy path (credit + order), not a bare credit. */
export function sweepTarget(reference: string, metadata?: any): PayPurpose {
  return purposeFromReference(reference, metadata)
}

export function sweepDecision(o: VerifyOutcome, ageMs: number): SweepDecision {
  const old = ageMs >= GIVE_UP_AFTER_MS
  switch (o.kind) {
    case 'error':
      return 'leave' // provider unreachable / timed out: try again next run
    case 'not_found':
      return old ? 'mark_failed' : 'leave'
    case 'status':
      if (o.status === 'success') return typeof o.amountKobo === 'number' ? 'complete' : 'leave'
      if (o.status === 'failed') return 'mark_failed'
      if (o.status === 'abandoned') return old ? 'mark_failed' : 'leave'
      return 'leave'
  }
}

/** Only an explicit Paystack "reference not found" rejection counts as not_found. */
export function classifyVerifyError(e: unknown): VerifyOutcome {
  if (e instanceof PaystackChargeError && e.definitive && /not found/i.test(e.message)) return { kind: 'not_found' }
  return { kind: 'error' }
}

/** Adds a sweep note to the row's metadata, keeping every existing key. Never stores provider/customer data. */
export function mergeSweepMetadata(existing: unknown, paystackStatus: string | undefined, result: SweepDecision, now: Date = new Date()) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {}
  return {
    ...base,
    sweep: { paystack_status: paystackStatus ?? null, result, checked_at: now.toISOString() },
  }
}
