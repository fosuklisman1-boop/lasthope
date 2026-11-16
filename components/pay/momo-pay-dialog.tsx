'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { canPay as canPayPhase, isDismissible, CONFIRMING_MESSAGE } from '@/lib/pay/momo-machine'
import { useMomoPayment, type MomoNetwork, type MomoPurpose } from './use-momo-payment'

export interface MomoPayDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  purpose: MomoPurpose
  payload: Record<string, unknown>
  summary: { label: string; total: number }
  guestEmail?: string
  defaultPhone?: string
  onSuccess(reference: string): void
  onOrderFailed?(reference: string): void
}

const NETWORKS: { value: MomoNetwork; label: string }[] = [
  { value: 'mtn', label: 'MTN' },
  { value: 'telecel', label: 'Telecel' },
  { value: 'airteltigo', label: 'AirtelTigo' },
]

export function MomoPayDialog(props: MomoPayDialogProps) {
  const { open, onOpenChange, purpose, payload, summary, guestEmail, defaultPhone, onSuccess, onOrderFailed } = props
  const [network, setNetwork] = useState<MomoNetwork>('mtn')
  const [phone, setPhone] = useState(defaultPhone ?? '')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { state, pay, submitCode, reset } = useMomoPayment({ purpose, payload, guestEmail, onSuccess, onOrderFailed })

  // Closing the dialog resets the machine so polling stops and a reopen starts a fresh attempt.
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  useEffect(() => { setCode('') }, [state.phase])

  const phase = state.phase
  const charging = phase === 'charging'
  const canPay = canPayPhase(phase)
  const waiting = phase === 'pay_offline'
  const needsCode = phase === 'send_otp' || phase === 'send_voucher'
  const total = `GH₵ ${summary.total.toFixed(2)}`

  async function handleCode() {
    if (!code.trim() || submitting) return
    setSubmitting(true)
    await submitCode(code.trim())
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next || isDismissible(phase)) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay with Mobile Money</DialogTitle>
          <DialogDescription>{summary.label}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-lg font-semibold">{total}</span>
        </div>

        {(canPay || charging) && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Network</Label>
              <Select value={network} onValueChange={(v) => setNetwork(v as MomoNetwork)} disabled={charging}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="momo-phone">Mobile money number</Label>
              <Input
                id="momo-phone"
                type="tel"
                inputMode="tel"
                placeholder="024XXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={charging}
              />
            </div>
            {phase === 'failed' && state.message && <p className="text-sm text-destructive">{state.message}</p>}
            {phase === 'timeout' && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Still waiting. If you approved, your balance/order will update shortly.
                </p>
                <p className="text-sm text-amber-600">
                  If you already approved a prompt on your phone, wait a minute before trying again.
                </p>
              </div>
            )}
            <Button className="w-full" disabled={charging || !phone.trim()} onClick={() => pay(network, phone.trim())}>
              {charging ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting payment...</>
              ) : phase === 'timeout' ? (
                'Try again'
              ) : (
                `Pay ${total}`
              )}
            </Button>
          </div>
        )}

        {waiting && (
          <div className="space-y-2 py-2 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="font-medium">
              {state.message === CONFIRMING_MESSAGE ? 'Confirming your payment' : 'Approve the payment prompt on your phone'}
            </p>
            {state.message &&<p className="text-sm text-muted-foreground">{state.message}</p>}
            <p className="text-xs text-muted-foreground">Keep this window open until the payment finishes.</p>
          </div>
        )}

        {needsCode && (
          <div className="space-y-3">
            <Label htmlFor="momo-code">{phase === 'send_voucher' ? 'Voucher code' : 'Verification code (OTP)'}</Label>
            <Input
              id="momo-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {state.message && <p className="text-sm text-destructive">{state.message}</p>}
            <Button className="w-full" disabled={submitting || !code.trim()} onClick={handleCode}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit code'}
            </Button>
            <p className="text-xs text-muted-foreground">Keep this window open until the payment finishes.</p>
          </div>
        )}

        {phase === 'success' && <p className="py-2 text-center font-medium">Payment successful</p>}
        {phase === 'order_failed' && (
          <p className="py-2 text-center text-sm">
            Payment received and added to your wallet; the order could not be placed. You can use your wallet balance to try again.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
