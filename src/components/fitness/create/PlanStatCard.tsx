import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PlanStatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'primary';
  className?: string;
}

/** Compact KPI tile used in the builder insight panel. */
export function PlanStatCard({ label, value, hint, icon, tone = 'default', className }: PlanStatCardProps) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-0 shadow-md transition-all duration-200',
        tone === 'primary'
          ? 'bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-primary/20'
          : 'bg-card shadow-muted-foreground/10',
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-xs font-semibold uppercase tracking-wider',
              tone === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {label}
          </p>
          {icon && (
            <span className={cn(tone === 'primary' ? 'text-primary-foreground/80' : 'text-primary')}>
              {icon}
            </span>
          )}
        </div>
        <p className="mt-1 text-2xl font-bold leading-none">{value}</p>
        {hint && (
          <p
            className={cn(
              'mt-1.5 text-xs',
              tone === 'primary' ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
