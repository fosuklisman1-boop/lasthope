export class PayError extends Error {
  constructor(message: string, public httpStatus: number) {
    super(message)
    this.name = 'PayError'
  }
}

export type PayPurpose = 'topup' | 'storefront' | 'upgrade' | 'direct_buy'
