import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
    {
        variants: {
            variant: {
                default: "clay bg-primary text-primary-foreground hover:brightness-110 hover:shadow-[0_0_24px_hsl(var(--neon-cyan)/0.45)]",
                destructive: "clay bg-destructive text-[hsl(350_80%_8%)] hover:brightness-110 hover:shadow-[0_0_22px_hsl(var(--neon-coral)/0.40)]",
                outline: "neo-raised-sm border border-white/[0.05] bg-card text-foreground hover:text-primary hover:shadow-[5px_5px_12px_hsl(var(--shade)/0.65),-3px_-3px_9px_hsl(var(--glint)/0.05),0_0_16px_hsl(var(--neon-cyan)/0.22)] active:shadow-[inset_3px_3px_8px_hsl(var(--shade)/0.8),inset_-2px_-2px_6px_hsl(var(--glint)/0.05)]",
                secondary: "neo-raised-sm bg-secondary text-secondary-foreground hover:brightness-110 active:shadow-[inset_3px_3px_8px_hsl(var(--shade)/0.8),inset_-2px_-2px_6px_hsl(var(--glint)/0.05)]",
                ghost: "hover:bg-accent hover:text-accent-foreground hover:shadow-[inset_2px_2px_6px_hsl(var(--shade)/0.6)]",
                link: "text-primary font-medium underline-offset-4 hover:underline hover:[text-shadow:0_0_12px_hsl(var(--neon-cyan)/0.6)]",
                success: "clay bg-[hsl(var(--neon-mint))] text-[hsl(165_80%_8%)] hover:brightness-110 hover:shadow-[0_0_22px_hsl(var(--neon-mint)/0.40)]",
                warning: "clay bg-[hsl(var(--neon-amber))] text-[hsl(35_80%_8%)] hover:brightness-110 hover:shadow-[0_0_22px_hsl(var(--neon-amber)/0.40)]",
                mtn: "clay bg-yellow-400 text-black hover:brightness-105",
                telecel: "clay bg-red-600 text-white hover:brightness-110",
                gradient: "clay bg-[hsl(var(--neon-violet))] text-[hsl(252_80%_8%)] hover:brightness-110 hover:shadow-[0_0_24px_hsl(var(--neon-violet)/0.45)]",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-lg px-3",
                lg: "h-11 rounded-xl px-8",
                xl: "h-12 rounded-2xl px-10 text-base",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
