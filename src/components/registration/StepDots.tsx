import { cn } from "@/lib/utils";

interface StepDotsProps {
  total: number;
  current: number;
  labels?: string[];
}

export function StepDots({ total, current, labels }: StepDotsProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center justify-center rounded-full transition-all duration-300",
                active
                  ? "h-2.5 w-8 bg-gradient-to-r from-primary to-primary"
                  : done
                  ? "h-2.5 w-2.5 bg-primary/70"
                  : "h-2.5 w-2.5 bg-card/20"
              )}
              aria-label={labels?.[i] ?? `Step ${i + 1}`}
            />
          </div>
        );
      })}
    </div>
  );
}
