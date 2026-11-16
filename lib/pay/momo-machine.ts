// Framework-free state machine for the MoMo pay dialog.
export type ServerState = 'pay_offline' | 'send_otp' | 'send_voucher' | 'success' | 'failed' | 'pending' | 'paid_order_failed'
export type Phase = 'idle' | 'charging' | 'pay_offline' | 'send_otp' | 'send_voucher' | 'success' | 'failed' | 'timeout' | 'order_failed'

export interface MachineState {
  phase: Phase
  reference?: string
  message?: string
}

export type MachineEvent =
  | { type: 'PAY' }
  | { type: 'CHARGE_OK'; reference: string; state: ServerState }
  | { type: 'CHARGE_ERROR'; message: string; reference?: string }
  | { type: 'SERVER_STATE'; state: ServerState; message?: string }
  | { type: 'OTP_RESULT'; state: ServerState }
  | { type: 'OTP_ERROR'; message: string }
  | { type: 'TICK'; elapsedMs: number }
  | { type: 'RESET' }

export const POLL_INTERVAL_MS = 3000
export const POLL_TIMEOUT_MS = 120000
export const AMBIGUOUS_MESSAGE =
  'We could not confirm the payment request. If you approve a prompt on your phone it will still be applied.'

/** Shown when /charge or /otp reports Paystack success before /status has run completion. */
export const CONFIRMING_MESSAGE = 'Payment approved. Confirming your payment...'

export const initialState: MachineState = { phase: 'idle' }

const TERMINAL: Phase[] = ['success', 'failed', 'timeout', 'order_failed']
const POLLING: Phase[] = ['pay_offline', 'send_otp', 'send_voucher']

/** A new charge may only start from these phases. */
export const canPay = (phase: Phase): boolean => phase === 'idle' || phase === 'failed' || phase === 'timeout'

/** The dialog may be closed only when no payment is in flight or awaiting approval. */
export const isDismissible = (phase: Phase): boolean =>
  phase === 'idle' || phase === 'success' || phase === 'failed' || phase === 'timeout' || phase === 'order_failed'

/** Responses from superseded attempts must be dropped. */
export const isCurrentAttempt = (current: number, responseAttempt: number): boolean => current === responseAttempt

export const isTerminal = (s: MachineState) => TERMINAL.includes(s.phase)
export const isPolling = (s: MachineState) => POLLING.includes(s.phase) && !!s.reference

/** onSuccess / onOrderFailed fire only for these states (reached only via /status, which runs completion). */
export const shouldNotify = (s: MachineState): boolean =>
  !!s.reference && (s.phase === 'success' || s.phase === 'order_failed')

/**
 * /charge and /otp return Paystack's raw state WITHOUT running completion, so a 'success'
 * from them only means "go confirm": keep polling /status (the only path that credits /
 * upgrades / places the order) instead of going terminal.
 */
function fromChargeOrOtp(reference: string | undefined, state: ServerState, s: MachineState): MachineState {
  if (state === 'success') return { phase: 'pay_offline', reference, message: CONFIRMING_MESSAGE }
  return fromServer({ ...s, reference }, state)
}

function fromServer(s: MachineState, state: ServerState, message?: string): MachineState {
  switch (state) {
    case 'success': return { phase: 'success', reference: s.reference }
    case 'failed': return { phase: 'failed', reference: s.reference, message }
    case 'paid_order_failed': return { phase: 'order_failed', reference: s.reference }
    case 'send_otp':
    case 'send_voucher':
      return s.phase === state ? s : { phase: state, reference: s.reference }
    case 'pay_offline':
      return s.phase === 'pay_offline' && !s.message ? s : { phase: 'pay_offline', reference: s.reference }
    default: // pending: stay where we are
      return s
  }
}

export function reduce(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'PAY':
      // A new Pay press always starts a fresh attempt; the old reference is abandoned.
      return canPay(s.phase) ? { phase: 'charging' } : s
    case 'CHARGE_OK':
      if (s.phase !== 'charging') return s
      if (e.state === 'pending') return { phase: 'pay_offline', reference: e.reference }
      return fromChargeOrOtp(e.reference, e.state, { phase: 'charging' })
    case 'CHARGE_ERROR':
      if (s.phase !== 'charging') return s
      if (e.reference) return { phase: 'pay_offline', reference: e.reference, message: AMBIGUOUS_MESSAGE }
      return { phase: 'failed', message: e.message }
    case 'SERVER_STATE':
      return POLLING.includes(s.phase) ? fromServer(s, e.state, e.message) : s
    case 'OTP_RESULT':
      return POLLING.includes(s.phase) ? fromChargeOrOtp(s.reference, e.state, { ...s, phase: 'pay_offline' }) : s
    case 'OTP_ERROR':
      return s.phase === 'send_otp' || s.phase === 'send_voucher' ? { ...s, message: e.message } : s
    case 'TICK':
      return isPolling(s) && e.elapsedMs >= POLL_TIMEOUT_MS ? { phase: 'timeout', reference: s.reference } : s
    case 'RESET':
      return initialState
  }
}
