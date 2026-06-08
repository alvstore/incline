"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const liquidButtonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-semibold transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-60 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-primary via-primary to-primary text-primary-foreground shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.6)] ring-1 ring-inset ring-white/15 hover:brightness-110",
        glass:
          "bg-card/10 backdrop-blur-xl text-primary-foreground ring-1 ring-inset ring-white/20 hover:bg-card/15",
        outline:
          "border border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-card/10",
        ghost: "text-primary-foreground hover:bg-card/10",
      },
      size: {
        sm: "h-10 px-4",
        default: "h-12 px-6",
        lg: "h-14 px-8 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface LiquidButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidButtonVariants> {
  asChild?: boolean;
  shimmer?: boolean;
}

export const LiquidButton = React.forwardRef<HTMLButtonElement, LiquidButtonProps>(
  ({ className, variant, size, asChild, shimmer = true, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(liquidButtonVariants({ variant, size }), className)} {...props}>
        {shimmer && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
          />
        )}
        <span className="relative inline-flex items-center gap-2">{children}</span>
      </Comp>
    );
  }
);
LiquidButton.displayName = "LiquidButton";

export { liquidButtonVariants };
