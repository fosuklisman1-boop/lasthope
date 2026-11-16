// Decides the HTTP status the Paystack webhook returns after running completion.
// Paystack retries non-2xx deliveries; completion is idempotent, so a retry is
// safe and is how a transient failure (DB hiccup, credit RPC error) heals.

export interface CompletionOutcome {
  success: boolean
  error?: string
  alreadyProcessed?: boolean
  pending?: boolean
  orderFailed?: boolean
}

/** Failures a retry cannot fix: acknowledge with 200 so Paystack stops redelivering. */
export const PERMANENT_COMPLETION_ERRORS = new Set([
  'Amount mismatch', // charged amount differs from the record: needs a human
  'Payment not found', // reference unknown to us
  'Order not found', // GST- reference unknown to us
  'Payment not completed', // DBY- row is failed/cancelled: never spend against it
])

export function webhookStatusFor(result: CompletionOutcome): 200 | 500 {
  if (result.success) return result.pending ? 500 : 200
  return result.error && PERMANENT_COMPLETION_ERRORS.has(result.error) ? 200 : 500
}
