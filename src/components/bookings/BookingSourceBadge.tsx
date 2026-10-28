import { Badge } from '@/components/ui/badge';
import { bookingSourceMeta } from '@/lib/bookings/bookingSource';
import { cn } from '@/lib/utils';

interface BookingSourceBadgeProps {
  source?: string | null;
  className?: string;
}

export function BookingSourceBadge({ source, className }: BookingSourceBadgeProps) {
  const meta = bookingSourceMeta(source);
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-[10px] font-medium whitespace-nowrap', meta.className, className)}
      aria-label={`Booked via ${meta.label}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}
