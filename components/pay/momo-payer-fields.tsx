'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MomoNetwork } from './use-momo-payment'

const NETWORKS: { value: MomoNetwork; label: string }[] = [
  { value: 'mtn', label: 'MTN' },
  { value: 'telecel', label: 'Telecel' },
  { value: 'airteltigo', label: 'AirtelTigo' },
]

export interface MomoPayerFieldsProps {
  idPrefix: string
  network: MomoNetwork
  phone: string
  onNetworkChange(n: MomoNetwork): void
  onPhoneChange(p: string): void
  disabled?: boolean
  helper?: string
  label?: string
}

export function MomoPayerFields({
  idPrefix, network, phone, onNetworkChange, onPhoneChange, disabled, helper, label = 'Mobile money number',
}: MomoPayerFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-network`}>Network</Label>
        <Select value={network} onValueChange={(v) => onNetworkChange(v as MomoNetwork)} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-network`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {NETWORKS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-phone`}>{label}</Label>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="tel"
          placeholder="024XXXXXXX"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          disabled={disabled}
        />
        {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      </div>
    </div>
  )
}
