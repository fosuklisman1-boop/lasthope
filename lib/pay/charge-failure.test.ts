import { describe, it, expect } from 'vitest'
import { shouldMarkFailed } from './charge-failure'
import { PaystackChargeError } from '@/lib/paystack-charge'

describe('shouldMarkFailed', () => {
  it('true for a definitive provider error', () => {
    expect(shouldMarkFailed(new PaystackChargeError('Declined', true))).toBe(true)
  })
  it('false for an ambiguous provider error', () => {
    expect(shouldMarkFailed(new PaystackChargeError('Could not reach payment provider'))).toBe(false)
  })
  it('false for unknown errors', () => {
    expect(shouldMarkFailed(new Error('boom'))).toBe(false)
    expect(shouldMarkFailed(undefined)).toBe(false)
  })
})
