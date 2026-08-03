import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookmarkCheck } from 'lucide-react';

export interface PlanMetaItem {
  icon: ReactNode;
  label: string;
  value: string;
}

interface PlanMetaCardProps {
  planName: string;
  description?: string | null;
  templateName?: string | null;
  icon: ReactNode;
  items: PlanMetaItem[];
  /** Download / secondary actions rendered in the header. */
  action?: ReactNode;
  statusLabel?: string;
}

/** Identical plan summary strip used by My Workout and My Diet. */
export function PlanMetaCard({
  planName,
  description,
  templateName,
  icon,
  items,
  action,
  statusLabel = 'Active',
}: PlanMetaCardProps) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="border-b border-border/60 bg-gradient-to-r from-accent/10 via-primary/10 to-accent/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold leading-tight">{planName}</h2>
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
              {templateName && (
                <Badge variant="secondary" className="mt-1.5 gap-1.5 text-[11px]">
                  <BookmarkCheck className="h-3 w-3" />
                  From template: <span className="font-semibold">{templateName}</span>
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {action}
            <Badge className="bg-success text-success-foreground">{statusLabel}</Badge>
          </div>
        </div>
      </div>

      <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {item.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</p>
              <p className="truncate text-sm font-semibold">{item.value}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
