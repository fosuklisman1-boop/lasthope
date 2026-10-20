import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
    {
        variants: {
            variant: {
                default:
                    "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
                secondary:
                    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
                destructive:
                    "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
                outline: "text-foreground",
                success:
                    "border-[hsl(var(--neon-mint)/0.35)] bg-[hsl(var(--neon-mint)/0.12)] text-[hsl(var(--neon-mint))] shadow-[0_0_14px_hsl(var(--neon-mint)/0.18)]",
                warning:
                    "border-[hsl(var(--neon-amber)/0.35)] bg-[hsl(var(--neon-amber)/0.12)] text-[hsl(var(--neon-amber))] shadow-[0_0_14px_hsl(var(--neon-amber)/0.18)]",
                pending:
                    "border-[hsl(var(--neon-amber)/0.35)] bg-[hsl(var(--neon-amber)/0.12)] text-[hsl(var(--neon-amber))] shadow-[0_0_14px_hsl(var(--neon-amber)/0.18)]",
                processing:
                    "border-[hsl(var(--neon-cyan)/0.35)] bg-[hsl(var(--neon-cyan)/0.12)] text-[hsl(var(--neon-cyan))] shadow-[0_0_14px_hsl(var(--neon-cyan)/0.18)]",
                completed:
                    "border-[hsl(var(--neon-mint)/0.35)] bg-[hsl(var(--neon-mint)/0.12)] text-[hsl(var(--neon-mint))] shadow-[0_0_14px_hsl(var(--neon-mint)/0.18)]",
                failed:
                    "border-[hsl(var(--neon-coral)/0.35)] bg-[hsl(var(--neon-coral)/0.12)] text-[hsl(var(--neon-coral))] shadow-[0_0_14px_hsl(var(--neon-coral)/0.18)]",
                mtn:
                    "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
                telecel:
                    "border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
                airteltigo:
                    "border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    )
}

export { Badge, badgeVariants }
