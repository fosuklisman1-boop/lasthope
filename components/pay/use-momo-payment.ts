'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  initialState,
  isPolling,
  canPay,
  isCurrentAttempt,
  reduce,
  shouldNotify,
  POLL_INTERVAL_MS,
  type MachineState,
  type ServerState,
} from '@/lib/pay/momo-machine'

export type MomoNetwork = 'mtn' | 'telecel' | 'airteltigo'
export type MomoPurpose = 'topup' | 'storefront' | 'upgrade' | 'direct_buy'

interface Options {
  purpose: MomoPurpose
  payload: Record<string, unknown>
  guestEmail?: string
  onSuccess(reference: string): void
  onOrderFailed?(reference: string): void
}

async function readJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return {} }
}

export function useMomoPayment(opts: Options) {
  const [state, dispatch] = useReducer(reduce, initialState as MachineState)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const startedAt = useRef<{ reference: string; at: number } | null>(null)
  const notified = useRef<string | null>(null)
  const alive = useRef(true)
  const phaseRef = useRef<MachineState['phase']>('idle')
  const attemptRef = useRef(0)
  phaseRef.current = state.phase

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const pay = useCallback(async (network: MomoNetwork, phone: string) => {
    if (!canPay(phaseRef.current)) return
    phaseRef.current = 'charging' // synchronous guard: a second call in the same tick is rejected
    const attempt = ++attemptRef.current
    dispatch({ type: 'PAY' })
    const { purpose, payload } = optsRef.current
    try {
      const res = await fetch('/api/pay/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, purpose, network, phone }),
      })
      const data = await readJson(res)
      if (!alive.current || !isCurrentAttempt(attemptRef.current, attempt)) return
      if (res.ok && typeof data.reference === 'string') {
        dispatch({ type: 'CHARGE_OK', reference: data.reference, state: data.state as ServerState })
      } else {
        dispatch({
          type: 'CHARGE_ERROR',
          message: typeof data.error === 'string' ? data.error : 'Payment could not be started',
          reference: typeof data.reference === 'string' ? data.reference : undefined,
        })
      }
    } catch {
      if (alive.current && isCurrentAttempt(attemptRef.current, attempt)) dispatch({ type: 'CHARGE_ERROR', message: 'Network error. Please try again.' })
    }
  }, [])

  const submitCode = useCallback(async (code: string) => {
    const reference = state.reference
    if (!reference) return
    const attempt = ++attemptRef.current
    try {
      const res = await fetch('/api/pay/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, code, email: optsRef.current.guestEmail }),
      })
      const data = await readJson(res)
      if (!alive.current || !isCurrentAttempt(attemptRef.current, attempt)) return
      if (res.ok && data.state) dispatch({ type: 'OTP_RESULT', state: data.state })
      else dispatch({ type: 'OTP_ERROR', message: typeof data.error === 'string' ? data.error : 'Code was not accepted' })
    } catch {
      if (alive.current && isCurrentAttempt(attemptRef.current, attempt)) dispatch({ type: 'OTP_ERROR', message: 'Network error. Please try again.' })
    }
  }, [state.reference])

  // Poll status while a reference is in a non-terminal state. Cleanup stops it on terminal state / unmount / close.
  const polling = isPolling(state)
  const reference = state.reference
  useEffect(() => {
    if (!polling || !reference) return
    if (startedAt.current?.reference !== reference) startedAt.current = { reference, at: Date.now() }
    const begin = startedAt.current.at
    let cancelled = false
    const ctrl = new AbortController()

    const timer = setInterval(async () => {
      const elapsedMs = Date.now() - begin
      try {
        const qs = new URLSearchParams({ reference })
        if (optsRef.current.guestEmail) qs.set('email', optsRef.current.guestEmail)
        const res = await fetch(`/api/pay/status?${qs.toString()}`, { signal: ctrl.signal, cache: 'no-store' })
        const data = await readJson(res)
        if (cancelled) return
        if (res.ok && data.state) dispatch({ type: 'SERVER_STATE', state: data.state, message: data.message })
      } catch {
        // transient network error: keep polling until timeout
      }
      if (!cancelled) dispatch({ type: 'TICK', elapsedMs })
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      ctrl.abort()
      clearInterval(timer)
    }
  }, [polling, reference])

  // Fire callbacks exactly once per reference.
  useEffect(() => {
    if (!state.reference || !shouldNotify(state)) return
    const key = `${state.phase}:${state.reference}`
    if (notified.current === key) return
    notified.current = key
    if (state.phase === 'success') optsRef.current.onSuccess(state.reference)
    else optsRef.current.onOrderFailed?.(state.reference)
  }, [state.phase, state.reference])

  const reset = useCallback(() => {
    attemptRef.current++ // invalidate any in-flight charge/otp response
    phaseRef.current = 'idle'
    dispatch({ type: 'RESET' })
  }, [])

  return { state, pay, submitCode, reset }
}
