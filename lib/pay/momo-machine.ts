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

export const initialState: MachineState = { phase: 'idle' }

const TERMINAL: Phase[] = ['success', 'failed', 'timeout', 'order_failed']
const POLLING: Phase[] = ['pay_offline', 'send_otp', 'send_voucher']

export const isTerminal = (s: MachineState) => TERMINAL.includes(s.phase)
export const isPolling = (s: MachineState) => POLLING.includes(s.phase) && !!s.reference

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
      return s.phase === 'idle' || s.phase === 'failed' || s.phase === 'timeout' ? { phase: 'charging' } : s
    case 'CHARGE_OK':
      if (s.phase !== 'charging') return s
      if (e.state === 'pending') return { phase: 'pay_offline', reference: e.reference }
      return fromServer({ phase: 'charging', reference: e.reference }, e.state)
    case 'CHARGE_ERROR':
      if (s.phase !== 'charging') return s
      if (e.reference) return { phase: 'pay_offline', reference: e.reference, message: AMBIGUOUS_MESSAGE }
      return { phase: 'failed', message: e.message }
    case 'SERVER_STATE':
      return POLLING.includes(s.phase) ? fromServer(s, e.state, e.message) : s
    case 'OTP_RESULT':
      return POLLING.includes(s.phase) ? fromServer({ ...s, phase: 'pay_offline' }, e.state) : s
    case 'OTP_ERROR':
      return s.phase === 'send_otp' || s.phase === 'send_voucher' ? { ...s, message: e.message } : s
    case 'TICK':
      return isPolling(s) && e.elapsedMs >= POLL_TIMEOUT_MS ? { phase: 'timeout', reference: s.reference } : s
    case 'RESET':
      return initialState
  }
}
