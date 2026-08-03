import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

interface PlanPageHeroProps {
  /** Small pill above the title (goal, plan status …). */
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Right-aligned CTA slot. */
  action?: ReactNode;
  /** Optional stat pills rendered under the headline. */
  stats?: { icon: ReactNode; label: string; value: string }[];
}

/**
 * Shared hero for the member plan pages (My Workout / My Diet) so both
 * surfaces use the exact same gradient, radius, shadow and rhythm.
 */
export function PlanPageHero({ eyebrow, title, subtitle, action, stats }: PlanPageHeroProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground shadow-lg shadow-primary/20 sm:p-8">
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/30 blur-3xl" />
        <div className="absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
      </div>

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle && (
            <p className="max-w-lg text-sm text-primary-foreground/85 sm:text-base">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl bg-white/15 p-3 backdrop-blur transition-colors duration-200 hover:bg-white/20"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-primary-foreground/80">
                {stat.icon}
                <span className="uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="mt-1 text-xl font-bold">{stat.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
