import crypto from 'node:crypto'

/** HMAC-SHA512 (hex) of the raw body, as Paystack sends in x-paystack-signature. */
export function signPaystackBody(rawBody: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(rawBody).digest('hex')
}

/** JSON body of a minimal charge.success event (amount in pesewas). */
export function buildChargeSuccessEvent(i: { reference: string; amountKobo: number }): { body: string } {
  return {
    body: JSON.stringify({
      event: 'charge.success',
      data: {
        reference: i.reference,
        amount: i.amountKobo,
        status: 'success',
        currency: 'GHS',
        channel: 'mobile_money',
        paid_at: new Date().toISOString(),
        metadata: {},
      },
    }),
  }
}
