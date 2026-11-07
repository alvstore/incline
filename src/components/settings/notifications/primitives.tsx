import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Shared card shell for every Notifications settings surface. */
export const settingsCardClass =
  'rounded-2xl border-0 bg-card shadow-lg shadow-foreground/5 transition-shadow duration-200 hover:shadow-xl hover:shadow-primary/10';

export function SettingsCard({
  icon: Icon, title, description, action, className, children,
}: {
  icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode;
  className?: string; children: ReactNode;
}) {
  return (
    <Card className={cn(settingsCardClass, className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-5 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0 rounded-full bg-primary/10 p-2 text-primary" aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold tracking-tight">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className="space-y-0.5 px-3 pb-4">{children}</CardContent>
    </Card>
  );
}

export function GroupLabel({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-1">
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />} {children}
    </p>
  );
}

export function StatusBadge({ tone, children }: { tone: 'on' | 'off' | 'warn'; children: ReactNode }) {
  const cls = {
    on: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    off: 'bg-muted text-muted-foreground border-border',
    warn: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  }[tone];
  return <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', cls)}>{children}</span>;
}

export function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-secondary">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
