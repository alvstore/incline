import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Beef, ChevronLeft, ChevronRight, Droplets, Flame, UtensilsCrossed, Wheat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NormalizedDietDay, NormalizedMealItem } from '@/lib/planNormalizer';

const itemLabel = (item: NormalizedMealItem) =>
  item.quantity ? `${item.food} — ${item.quantity}` : item.food;

interface DietDayCardProps {
  day: NormalizedDietDay;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}

/** Focused single-day meal schedule — the diet twin of DaySessionCard. */
export function DietDayCard({ day, hasPrev, hasNext, onPrev, onNext }: DietDayCardProps) {
  const macroChips = [
    { icon: <Flame className="h-3 w-3" />, value: `${Math.round(day.totals.calories)} kcal` },
    { icon: <Beef className="h-3 w-3" />, value: `${Math.round(day.totals.protein)}g protein` },
    { icon: <Wheat className="h-3 w-3" />, value: `${Math.round(day.totals.carbs)}g carbs` },
    { icon: <Droplets className="h-3 w-3" />, value: `${Math.round(day.totals.fats)}g fats` },
  ];

  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-accent/10 via-primary/10 to-accent/5 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <UtensilsCrossed className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">{day.day}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {day.slots.length} {day.slots.length === 1 ? 'meal' : 'meals'} scheduled
              </p>
            </div>
          </div>
          {(onPrev || onNext) && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous day"
                disabled={!hasPrev}
                onClick={onPrev}
                className="h-8 w-8 rounded-full"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next day"
                disabled={!hasNext}
                onClick={onNext}
                className="h-8 w-8 rounded-full"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-3">
          {macroChips.map((chip) => (
            <Badge key={chip.value} variant="secondary" className="gap-1 text-xs">
              {chip.icon}
              {chip.value}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 p-4 sm:p-5">
        {day.slots.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No meals scheduled for this day.
          </p>
        )}
        {day.slots.map((slot, idx) => (
          <div
            key={`${slot.name}-${idx}`}
            className="rounded-2xl bg-muted/30 p-4 transition-colors duration-200 hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <UtensilsCrossed className="h-4 w-4" />
                </span>
                <p className="truncate text-sm font-semibold">{slot.name}</p>
              </div>
              {slot.time && (
                <Badge variant="outline" className="shrink-0 font-mono text-xs">
                  {slot.time}
                </Badge>
              )}
            </div>

            {slot.items.length > 0 && (
              <ul className="mt-3 space-y-1.5 pl-10">
                {slot.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
                    <span className="min-w-0 flex-1 text-foreground/90">{itemLabel(item)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-4 shrink-0 px-1.5 py-0 text-[10px]',
                        item.catalog_id
                          ? 'border-success/40 bg-success/5 text-success'
                          : 'text-muted-foreground',
                      )}
                    >
                      {item.catalog_id ? 'Catalog' : 'AI'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}

            {(slot.totals.calories > 0 || slot.totals.protein > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2 pl-10">
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Flame className="h-3 w-3" /> {Math.round(slot.totals.calories)} kcal
                </Badge>
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Beef className="h-3 w-3" /> {Math.round(slot.totals.protein)}g
                </Badge>
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Wheat className="h-3 w-3" /> {Math.round(slot.totals.carbs)}g
                </Badge>
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Droplets className="h-3 w-3" /> {Math.round(slot.totals.fats)}g
                </Badge>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
