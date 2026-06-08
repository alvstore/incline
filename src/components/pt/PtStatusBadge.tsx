import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, XCircle, Sun, Ban, CalendarOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PtSessionStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'
  | 'absent'
  | 'holiday'
  | 'late';

const STYLES: Record<string, { label: string; cls: string; Icon: any }> = {
  completed:   { label: 'Present',   cls: 'bg-success/15 text-success border-success/25',  Icon: CheckCircle2 },
  late:        { label: 'Late',      cls: 'bg-warning/15 text-warning border-warning/25',         Icon: Clock },
  absent:      { label: 'Absent',    cls: 'bg-destructive/15 text-destructive border-destructive/25',               Icon: XCircle },
  holiday:     { label: 'Holiday',   cls: 'bg-info/15 text-info border-info/25',            Icon: Sun },
  cancelled:   { label: 'Cancelled', cls: 'bg-muted text-muted-foreground border-border',         Icon: Ban },
  no_show:     { label: 'No-show',   cls: 'bg-destructive/10 text-destructive border-destructive/25',                Icon: Ban },
  scheduled:   { label: 'Scheduled', cls: 'bg-muted text-foreground border-border',         Icon: Clock },
  rescheduled: { label: 'Rescheduled', cls: 'bg-primary/15 text-primary border-primary/25',    Icon: CalendarOff },
};

export function PtStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STYLES[status] ?? STYLES.scheduled;
  const Icon = s.Icon;
  return (
    <Badge variant="outline" className={cn('gap-1 rounded-full border', s.cls, className)}>
      <Icon className="h-3 w-3" />
      {s.label}
    </Badge>
  );
}
