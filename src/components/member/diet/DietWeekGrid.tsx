import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Flame, Layers, UtensilsCrossed } from 'lucide-react';
import type { NormalizedDietDay } from '@/lib/planNormalizer';

interface DietWeekGridProps {
  days: NormalizedDietDay[];
  onOpenDay: (index: number) => void;
}

/** Week-at-a-glance nutrition grid, mirroring the workout WeekGrid. */
export function DietWeekGrid({ days, onOpenDay }: DietWeekGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {days.map((day, index) => (
        <Card
          key={`${day.day}-${index}`}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDay(index)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenDay(index);
            }
          }}
          className={cn(
            'cursor-pointer rounded-2xl border-border/60 shadow-sm transition-all duration-200',
            'hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary',
            day.slots.length === 0 && 'bg-muted/30',
          )}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
                <UtensilsCrossed className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">{day.day}</span>
            </CardTitle>
            <p className="pl-10 text-xs text-muted-foreground">
              {day.slots.length ? `${day.slots.length} meals planned` : 'No meals scheduled'}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5" /> {Math.round(day.totals.calories)} kcal
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> {Math.round(day.totals.protein)}g protein
              </span>
            </div>
            <ul className="space-y-1 pt-1">
              {day.slots.slice(0, 4).map((slot, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{slot.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {slot.time || `${Math.round(slot.totals.calories)} kcal`}
                  </span>
                </li>
              ))}
            </ul>
            {day.slots.length > 4 && (
              <Badge variant="secondary" className="text-[11px]">
                +{day.slots.length - 4} more
              </Badge>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
