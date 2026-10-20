"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitives.Root>,
    React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
    <SwitchPrimitives.Root
        className={cn(
            "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 neo-inset data-[state=checked]:shadow-[inset_3px_3px_8px_hsl(var(--shade)/0.8),0_0_14px_hsl(var(--neon-cyan)/0.45)] data-[state=checked]:bg-primary/30 data-[state=unchecked]:bg-[hsl(var(--well))]",
            className
        )}
        {...props}
        ref={ref}
    >
        <SwitchPrimitives.Thumb
            className={cn(
                "pointer-events-none block h-5 w-5 rounded-full bg-secondary shadow-[0_2px_6px_hsl(var(--shade)/0.7),inset_0_1px_0_hsl(0_0%_100%/0.25)] ring-0 data-[state=checked]:bg-primary transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
            )}
        />
    </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
