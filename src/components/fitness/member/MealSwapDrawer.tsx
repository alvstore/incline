import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ChefHat, Flame, Utensils } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMealCatalog,
  recordMealSwap,
  type MealCatalogItem,
  type DietPlanSource,
} from '@/services/memberPlanProgressService';
import type { MealEntry } from '@/types/fitnessPlan';
import { toast } from 'sonner';

interface MealSwapDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  planSource: DietPlanSource;
  planId: string;
  mealIndex: number;
  currentMeal: MealEntry;
  dietaryType?: string | null;
  cuisine?: string | null;
  onSwapComplete?: () => void;
}

function macroFromMeal(meal: MealEntry): number {
  if (typeof meal.calories === 'number') return meal.calories;
  if (Array.isArray(meal.items)) {
    return meal.items.reduce((acc, it) => {
      if (typeof it === 'string') return acc;
      return acc + (it.calories || 0);
    }, 0);
  }
  return 0;
}

export function MealSwapDrawer({
  open,
  onOpenChange,
  memberId,
  planSource,
  planId,
  mealIndex,
  currentMeal,
  dietaryType,
  cuisine,
  onSwapComplete,
}: MealSwapDrawerProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const currentCalories = useMemo(() => macroFromMeal(currentMeal), [currentMeal]);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['meal-catalog', dietaryType, cuisine, search],
    enabled: open,
    queryFn: () =>
      fetchMealCatalog({
        dietary_type: dietaryType || undefined,
        cuisine: cuisine || undefined,
        search: search || undefined,
      }),
    staleTime: 60 * 1000,
  });

  const sorted = useMemo(() => {
    if (!currentCalories) return candidates;
    return [...candidates].sort(
      (a, b) => Math.abs(a.calories - currentCalories) - Math.abs(b.calories - currentCalories),
    );
  }, [candidates, currentCalories]);

  const performSwap = async (item: MealCatalogItem) => {
    setSubmitting(item.id);
    try {
      const newMeal: MealEntry = {
        name: item.name,
        time: currentMeal.time,
        items: [
          {
            food: item.name,
            quantity: item.default_quantity || '',
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fats: item.fats,
            fiber: item.fiber,
          },
        ],
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fats: item.fats,
        prep_video_url: item.prep_video_url || undefined,
        recipe_link: item.recipe_link || undefined,
      };
      await recordMealSwap({
        member_id: memberId,
        plan_source: planSource,
        plan_id: planId,
        meal_index: mealIndex,
        original_meal: currentMeal,
        new_meal: newMeal,
        catalog_meal_id: item.id,
      });
      toast.success(`Swapped to ${item.name}`);
      qc.invalidateQueries({ queryKey: ['meal-swaps', memberId, planSource, planId] });
      qc.invalidateQueries({ queryKey: ['member-plan-progress', memberId] });
      onSwapComplete?.();
      onOpenChange(false);
    } catch (e) {
      console.error('swap meal failed', e);
      toast.error('Failed to swap meal');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} width="2xl">
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-accent" />
          Swap "{currentMeal.name}"
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>
          Pick an alternative from the catalog
          {dietaryType ? ` · ${dietaryType.replace('_', ' ')}` : ''}
          {cuisine ? ` · ${cuisine}` : ''}
          {currentCalories ? ` · ~${currentCalories} kcal` : ''}
        </ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <div className="flex-1 overflow-hidden flex flex-col gap-3 mt-3">
        <Input
          placeholder="Search meals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          ) : sorted.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No matching meals in the catalog yet.
              </CardContent>
            </Card>
          ) : (
            sorted.map((item) => {
              const diff = currentCalories ? item.calories - currentCalories : 0;
              return (
                <Card key={item.id} className="hover:border-accent/50 transition-colors">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-muted shrink-0">
                      <Utensils className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {item.description || item.default_quantity || '—'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => performSwap(item)}
                          disabled={!!submitting}
                        >
                          {submitting === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Select'
                          )}
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <Badge variant="secondary" className="text-[10px]">
                          <Flame className="h-3 w-3 mr-0.5" />
                          {Math.round(item.calories)} kcal
                          {currentCalories && diff !== 0 && (
                            <span className={diff > 0 ? 'text-warning ml-1' : 'text-success ml-1'}>
                              ({diff > 0 ? '+' : ''}{Math.round(diff)})
                            </span>
                          )}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">P {Math.round(item.protein)}g</Badge>
                        <Badge variant="outline" className="text-[10px]">C {Math.round(item.carbs)}g</Badge>
                        <Badge variant="outline" className="text-[10px]">F {Math.round(item.fats)}g</Badge>
                        {item.tags?.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] capitalize">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      <ResponsiveSheetFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
      </ResponsiveSheetFooter>
    </ResponsiveSheet>
  );
}
