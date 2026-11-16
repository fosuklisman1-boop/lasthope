import { describe, it, expect } from 'vitest'
import { webhookStatusFor } from './webhook-outcome'

describe('webhookStatusFor', () => {
  const table: [string, Parameters<typeof webhookStatusFor>[0], 200 | 500][] = [
    ['completed', { success: true }, 200],
    ['already processed', { success: true, alreadyProcessed: true }, 200],
    ['DBY paid, order failed (money in wallet; terminal)', { success: true, orderFailed: true }, 200],
    ['DBY pending (credit not yet recorded) -> retry', { success: true, pending: true, alreadyProcessed: true }, 500],
    ['amount mismatch is permanent', { success: false, error: 'Amount mismatch' }, 200],
    ['unknown wallet reference', { success: false, error: 'Payment not found' }, 200],
    ['unknown order reference', { success: false, error: 'Order not found' }, 200],
    ['DBY row failed/cancelled is permanent', { success: false, error: 'Payment not completed' }, 200],
    ['credit failure is transient', { success: false, error: 'Failed to credit wallet' }, 500],
    ['status update failure is transient', { success: false, error: 'Failed to update payment status' }, 500],
    ['upgrade status update failure (with detail) is transient', { success: false, error: 'Failed to update payment status: timeout' }, 500],
    ['role grant failure is transient', { success: false, error: 'Failed to update user role' }, 500],
    ['shop order update failure is transient', { success: false, error: 'Failed to update order status' }, 500],
    ['unknown error defaults to retry', { success: false }, 500],
  ]
  for (const [name, result, want] of table) {
    it(`${name} -> ${want}`, () => expect(webhookStatusFor(result)).toBe(want))
  }
})
