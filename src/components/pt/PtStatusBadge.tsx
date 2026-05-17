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
  completed:   { label: 'Present',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200',  Icon: CheckCircle2 },
  late:        { label: 'Late',      cls: 'bg-amber-100 text-amber-700 border-amber-200',         Icon: Clock },
  absent:      { label: 'Absent',    cls: 'bg-red-100 text-red-700 border-red-200',               Icon: XCircle },
  holiday:     { label: 'Holiday',   cls: 'bg-blue-100 text-blue-700 border-blue-200',            Icon: Sun },
  cancelled:   { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200',         Icon: Ban },
  no_show:     { label: 'No-show',   cls: 'bg-red-50 text-red-600 border-red-200',                Icon: Ban },
  scheduled:   { label: 'Scheduled', cls: 'bg-slate-100 text-slate-700 border-slate-200',         Icon: Clock },
  rescheduled: { label: 'Rescheduled', cls: 'bg-violet-100 text-violet-700 border-violet-200',    Icon: CalendarOff },
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
