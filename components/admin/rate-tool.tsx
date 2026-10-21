'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Calculator } from 'lucide-react'
import { toast } from 'sonner'
import { parsePrice, planRatePrices, type RatePlan, type RateRow } from '@/lib/price-tables'

const STEPS = [
    { value: '0.01', label: 'Nearest pesewa' },
    { value: '0.05', label: 'Nearest 5 pesewas' },
    { value: '0.1', label: 'Nearest 10 pesewas' },
    { value: '0.5', label: 'Nearest 50 pesewas' },
    { value: '1', label: 'Nearest cedi' },
]

interface Props {
    rows: RateRow[]
    /** Called with the plan when the admin presses Apply. Nothing is saved by this tool. */
    onApply: (plan: RatePlan, ratePerGb: number) => void
    /** What the rate sets, for the labels: for example "price" or "cost price". */
    noun?: string
    /** Start with "replace existing prices" on. */
    defaultOverwrite?: boolean
    className?: string
}

/**
 * Price per GB: enter 3.90 and a 5GB package becomes 19.50. Works on the rows it is given and
 * hands back the result for the screen to review and save, so nothing changes until the admin confirms.
 */
export function RateTool({ rows, onApply, noun = 'price', defaultOverwrite = false, className }: Props) {
    const [rate, setRate] = useState('')
    const [step, setStep] = useState('0.01')
    const [network, setNetwork] = useState('all')
    const [overwrite, setOverwrite] = useState(defaultOverwrite)

    const networks = useMemo(() => Array.from(new Set(rows.map(r => r.network))), [rows])

    const apply = () => {
        const parsed = parsePrice(rate)
        if (!parsed.ok) return toast.error(`Enter the ${noun} per GB, for example 3.90`)
        const plan = planRatePrices(rows, { ratePerGb: parsed.price, step: Number(step), network, overwrite })
        const n = Object.keys(plan.updates).length
        if (n === 0) {
            return toast.error(
                plan.keptExisting > 0
                    ? `Nothing to fill: ${plan.keptExisting} already ${plan.keptExisting === 1 ? 'has' : 'have'} a ${noun}. Turn on "replace existing" to overwrite.`
                    : plan.skippedUnreadable.length > 0 ? 'None of the sizes could be read as GB.' : 'No packages match.'
            )
        }
        onApply(plan, parsed.price)
        const notes = [
            plan.keptExisting > 0 ? `${plan.keptExisting} kept as they were` : '',
            plan.skippedUnreadable.length > 0 ? `${plan.skippedUnreadable.length} skipped (size not in GB: ${plan.skippedUnreadable.slice(0, 3).join(', ')}${plan.skippedUnreadable.length > 3 ? '…' : ''})` : '',
        ].filter(Boolean).join('; ')
        toast.success(`Set ${n} ${noun}${n === 1 ? '' : 's'} at ${parsed.price.toFixed(2)} per GB${notes ? `. ${notes}` : ''}`)
    }

    return (
        <div className={`space-y-3 ${className ?? ''}`}>
            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                    <Label htmlFor="rate-per-gb">{noun.charAt(0).toUpperCase() + noun.slice(1)} per GB (GHS)</Label>
                    <Input id="rate-per-gb" type="number" inputMode="decimal" min={0} step="0.01" className="w-32" value={rate} onChange={e => setRate(e.target.value)} placeholder="3.90" />
                </div>
                <div className="space-y-1.5">
                    <Label>Networks</Label>
                    <Select value={network} onValueChange={setNetwork}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All networks</SelectItem>
                            {networks.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label>Round to</Label>
                    <Select value={step} onValueChange={setStep}>
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>{STEPS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                    <Switch id="rate-overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
                    <Label htmlFor="rate-overwrite" className="text-sm">Replace existing</Label>
                </div>
                <Button variant="outline" onClick={apply}><Calculator className="mr-2 h-4 w-4" />Apply rate</Button>
            </div>
            <p className="text-xs text-muted-foreground">A 5GB package at 3.90 per GB becomes 19.50. Sizes in MB count as a part of a GB (500MB is 0.5GB). Nothing is saved until you review and confirm.</p>
        </div>
    )
}
