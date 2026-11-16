import { PaystackChargeError } from '@/lib/paystack-charge'

/**
 * Only mark a pending record failed when Paystack definitively did not create the charge.
 * An ambiguous error (timeout, 5xx, lost response) may still have produced a charge the
 * customer can approve, so the row must stay pending for the status poll to complete.
 */
export function shouldMarkFailed(err: unknown): boolean {
  return err instanceof PaystackChargeError && err.definitive === true
}
