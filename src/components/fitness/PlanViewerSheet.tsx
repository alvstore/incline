import { useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Dumbbell, Utensils, Download, Calendar, User, Flame, Apple, Target } from 'lucide-react';
import { normalizeDietPlan } from '@/lib/planNormalizer';


interface PlanViewerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: {
    id?: string;
    name: string;
    type: 'workout' | 'diet';
    description?: string | null;
    data: any;
    member_name?: string | null;
    trainer_name?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    template_name?: string | null;
    /** PDF-template support — when set to 'pdf', renders an inline PDF iframe instead of structured days. */
    source_kind?: 'structured' | 'pdf';
    pdf_url?: string | null;
    pdf_filename?: string | null;
    template_id?: string | null;
  } | null;
  onDownload?: () => void;
  onAssign?: () => void;
  footerExtras?: React.ReactNode;
}


/** Right-side drawer that renders a workout or diet plan in human-friendly form. */
export function PlanViewerSheet({
  open,
  onOpenChange,
  plan,
  onDownload,
  onAssign,
  footerExtras,
}: PlanViewerSheetProps) {

  const weeks = useMemo(() => {
    if (!plan) return [];
    const w = plan.data?.weeks;
    return Array.isArray(w) ? w : [];
  }, [plan]);

  // Diet plans come in three stored shapes (weekly `meals`, manual `slots`,
  // pre-normalized `days`) — the shared normalizer handles all of them.
  const meals = useMemo(() => {
    if (!plan || plan.type !== 'diet') return [];
    return normalizeDietPlan(plan.data || {}).days;
  }, [plan]);


  if (!plan) return null;

  const Icon = plan.type === 'workout' ? Dumbbell : Utensils;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate">{plan.name}</SheetTitle>
              <SheetDescription className="truncate">
                {plan.type === 'workout' ? 'Workout plan' : 'Diet plan'}
                {plan.member_name && ` · for ${plan.member_name}`}
                {plan.trainer_name && ` · by ${plan.trainer_name}`}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-3">
            {plan.template_name && (
              <Badge variant="outline" className="text-xs">
                Template: {plan.template_name}
              </Badge>
            )}
            {plan.valid_from && (
              <Badge variant="outline" className="text-xs gap-1">
                <Calendar className="h-3 w-3" />
                From {plan.valid_from}
              </Badge>
            )}
            {plan.valid_until && (
              <Badge variant="outline" className="text-xs gap-1">
                <Calendar className="h-3 w-3" />
                Until {plan.valid_until}
              </Badge>
            )}
            {plan.data?.dailyCalories && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Flame className="h-3 w-3" />
                {plan.data.dailyCalories} kcal/day
              </Badge>
            )}
          </div>
          {plan.description && (
            <p className="text-sm text-muted-foreground pt-2">{plan.description}</p>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {plan.source_kind === 'pdf' && plan.pdf_url ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground flex items-center justify-between">
                <span className="truncate">{plan.pdf_filename || 'PDF document'}</span>
                <a
                  href={plan.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Open in new tab
                </a>
              </div>
              <iframe
                src={plan.pdf_url}
                title={plan.name}
                className="w-full h-[70vh] rounded-xl border bg-background"
              />
            </div>
          ) : plan.type === 'workout' ? (
            weeks.length > 0 ? (
              <Accordion type="multiple" defaultValue={["w0"]} className="space-y-2">
                {weeks.map((week: any, wi: number) => (
                  <AccordionItem
                    key={wi}
                    value={`w${wi}`}
                    className="border rounded-xl px-3 bg-card"
                  >
                    <AccordionTrigger className="text-sm font-semibold hover:no-underline">
                      Week {week.week ?? wi + 1}
                      <Badge variant="outline" className="ml-2 text-xs">
                        {(week.days || []).length} days
                      </Badge>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pt-2">
                      {(week.days || []).map((day: any, di: number) => (
                        <div key={di} className="rounded-xl bg-muted/40 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">{day.day || `Day ${di + 1}`}</p>
                            {day.focus && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Target className="h-3 w-3" />
                                {day.focus}
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {(day.exercises || []).map((ex: any, ei: number) => (
                              <div
                                key={ei}
                                className="flex items-center gap-3 rounded-lg bg-background px-3 py-2 text-sm"
                              >
                                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center font-semibold shrink-0">
                                  {ei + 1}
                                </div>
                                <span className="flex-1 truncate">{ex.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {ex.sets}×{ex.reps}
                                  {ex.rest ? ` · ${ex.rest}` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                This plan has no scheduled exercises yet.
              </p>
            )
          ) : meals.length > 0 ? (
            <div className="space-y-3">
              {meals.map((day, di) => (
                <div key={di} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm">{day.day || `Day ${di + 1}`}</p>
                    {day.totals.calories > 0 && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Flame className="h-3 w-3" />
                        {Math.round(day.totals.calories)} kcal · P {Math.round(day.totals.protein)}g ·
                        C {Math.round(day.totals.carbs)}g · F {Math.round(day.totals.fats)}g
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    {day.slots.map((meal, mi) => (
                      <div key={mi} className="rounded-lg bg-muted/40 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium flex items-center gap-2">
                            <Apple className="h-3.5 w-3.5 text-success" />
                            {meal.name || `Meal ${mi + 1}`}
                          </p>
                          {meal.time && (
                            <span className="text-xs text-muted-foreground">{meal.time}</span>
                          )}
                        </div>
                        {meal.items.length > 0 && (
                          <ul className="mt-1 ml-5 list-disc text-xs text-muted-foreground space-y-0.5">
                            {meal.items.map((it, ii) => (
                              <li key={ii}>
                                {it.food}
                                {it.quantity ? ` — ${it.quantity}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(meal.totals.calories > 0 || meal.totals.protein > 0) && (
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            <span><b className="text-foreground">{Math.round(meal.totals.calories)}</b> kcal</span>
                            <span>P {Math.round(meal.totals.protein)}g</span>
                            <span>C {Math.round(meal.totals.carbs)}g</span>
                            <span>F {Math.round(meal.totals.fats)}g</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              This diet plan has no meals defined yet.
            </p>
          )}
        </ScrollArea>

        <SheetFooter className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onDownload} className="gap-1.5 h-9">
              <Download className="h-4 w-4" />
              Download
            </Button>
            {onAssign && (
              <Button onClick={onAssign} className="gap-1.5 h-9 bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                Assign Plan
              </Button>
            )}
          </div>
          {footerExtras}
        </SheetFooter>

      </SheetContent>
    </Sheet>
  );
}
