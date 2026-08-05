import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetFooter,
} from '@/components/ui/ResponsiveSheet';
import { Plus, Trash2, Edit, UtensilsCrossed, Loader2, Search, Eye, Upload, Download } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMealCatalog,
  createMealCatalogEntry,
  updateMealCatalogEntry,
  deleteMealCatalogEntry,
  MealCatalogEntry,
  MealType,
} from '@/services/mealCatalogService';
import { DIETARY_PREFERENCES, CUISINE_PREFERENCES } from '@/types/fitnessPlan';
import { toast } from 'sonner';
import { FitnessHubTabs } from '@/components/fitness/FitnessHubTabs';
import { MealCatalogImportSheet } from '@/components/fitness/MealCatalogImportSheet';
import { mealsToCsv, downloadCsvFile, mealTemplateCsv } from '@/lib/nutrition/mealCatalogCsv';


const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'pre_workout', label: 'Pre-workout' },
  { value: 'post_workout', label: 'Post-workout' },
];

const EMPTY: Omit<MealCatalogEntry, 'id' | 'created_at' | 'updated_at' | 'is_active'> = {
  branch_id: null,
  name: '',
  dietary_type: 'vegetarian',
  cuisine: 'indian',
  meal_type: 'breakfast',
  default_quantity: '',
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
  fiber: 0,
  micronutrients: '',
  tags: [],
  notes: '',
};

export default function MealCatalog() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterDiet, setFilterDiet] = useState<string>('all');
  const [filterCuisine, setFilterCuisine] = useState<string>('all');
  const [editing, setEditing] = useState<MealCatalogEntry | null>(null);
  const [viewing, setViewing] = useState<MealCatalogEntry | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);


  const { data: meals = [], isLoading } = useQuery({
    queryKey: ['meal-catalog-admin', search, filterDiet, filterCuisine],
    queryFn: () =>
      fetchMealCatalog({
        search: search || undefined,
        dietaryType: filterDiet === 'all' ? null : filterDiet,
        cuisine: filterCuisine === 'all' ? null : filterCuisine,
      }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error('Name is required');
      if (editing) {
        await updateMealCatalogEntry(editing.id, draft);
      } else {
        await createMealCatalogEntry(draft);
      }
    },
    onSuccess: () => {
      toast.success(editing ? 'Meal updated' : 'Meal added');
      setDraftOpen(false);
      setEditing(null);
      setDraft(EMPTY);
      queryClient.invalidateQueries({ queryKey: ['meal-catalog-admin'] });
      queryClient.invalidateQueries({ queryKey: ['meal-catalog'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMealCatalogEntry,
    onSuccess: () => {
      toast.success('Meal removed');
      queryClient.invalidateQueries({ queryKey: ['meal-catalog-admin'] });
      queryClient.invalidateQueries({ queryKey: ['meal-catalog'] });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY);
    setDraftOpen(true);
  };

  const openEdit = (m: MealCatalogEntry) => {
    setEditing(m);
    setDraft({
      branch_id: m.branch_id,
      name: m.name,
      dietary_type: m.dietary_type,
      cuisine: m.cuisine,
      meal_type: m.meal_type,
      default_quantity: m.default_quantity || '',
      calories: m.calories,
      protein: m.protein,
      carbs: m.carbs,
      fats: m.fats,
      fiber: m.fiber,
      micronutrients: m.micronutrients || '',
      tags: m.tags,
      notes: m.notes || '',
    });
    setDraftOpen(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5 text-accent" />
              Meal Catalog
            </h2>
            <p className="text-sm text-muted-foreground">Master list of meals used by the diet builder's swap modal</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => downloadCsvFile('meal_catalog_template.csv', mealTemplateCsv())}>
              <Download className="h-4 w-4 mr-2" />
              Template
            </Button>
            <Button
              variant="outline"
              disabled={!meals.length}
              onClick={() => downloadCsvFile(`meal_catalog_${new Date().toISOString().slice(0, 10)}.csv`, mealsToCsv(meals))}
            >
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Meal
            </Button>
          </div>
        </div>


        <Card>
          <CardHeader className="pb-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="relative sm:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search meals..."
                  className="pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterDiet} onValueChange={setFilterDiet}>
                <SelectTrigger><SelectValue placeholder="All diets" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All diets</SelectItem>
                  {DIETARY_PREFERENCES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterCuisine} onValueChange={setFilterCuisine}>
                <SelectTrigger><SelectValue placeholder="All cuisines" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cuisines</SelectItem>
                  {CUISINE_PREFERENCES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : meals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No meals match the filters.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {meals.map((m) => (
                  <Card key={m.id} className="border-border/60">
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{m.name}</p>
                          {m.default_quantity && <p className="text-xs text-muted-foreground">{m.default_quantity}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setViewing(m)} title="View">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(m)} title="Edit">
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(m.id)} title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">{m.dietary_type.replace('_', ' ')}</Badge>
                        <Badge variant="outline" className="text-[10px]">{m.cuisine.replace('_', ' ')}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{m.meal_type}</Badge>
                      </div>
                      <div className="flex gap-3 text-[11px] text-muted-foreground">
                        <span><b className="text-foreground">{m.calories}</b> kcal</span>
                        <span>P {m.protein}g</span>
                        <span>C {m.carbs}g</span>
                        <span>F {m.fats}g</span>
                      </div>
                      {m.micronutrients && (
                        <p className="text-[11px] text-muted-foreground truncate" title={m.micronutrients}>
                          <span className="font-medium text-foreground">Micros:</span> {m.micronutrients}
                        </p>
                      )}

                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ResponsiveSheet open={draftOpen} onOpenChange={setDraftOpen} width="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{editing ? 'Edit Meal' : 'Add Meal'}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <div className="space-y-3 mt-4 flex-1">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Diet</Label>
              <Select value={draft.dietary_type} onValueChange={(v) => setDraft({ ...draft, dietary_type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIETARY_PREFERENCES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cuisine</Label>
              <Select value={draft.cuisine} onValueChange={(v) => setDraft({ ...draft, cuisine: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CUISINE_PREFERENCES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Meal type</Label>
              <Select value={draft.meal_type} onValueChange={(v) => setDraft({ ...draft, meal_type: v as MealType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Default quantity</Label>
            <Input value={draft.default_quantity || ''} onChange={(e) => setDraft({ ...draft, default_quantity: e.target.value })} placeholder="e.g. 1 bowl, 200g" />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {(['calories', 'protein', 'carbs', 'fats', 'fiber'] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label className="text-xs capitalize">{k === 'calories' ? 'kcal' : `${k} g`}</Label>
                <Input
                  type="number"
                  value={draft[k] as number}
                  onChange={(e) => setDraft({ ...draft, [k]: parseFloat(e.target.value) || 0 })}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label>Key micronutrients</Label>
            <Input
              value={draft.micronutrients || ''}
              onChange={(e) => setDraft({ ...draft, micronutrients: e.target.value })}
              placeholder="e.g. Calcium, Iron, B12"
            />
          </div>
          <div className="space-y-1">
            <Label>Tags (comma-separated)</Label>
            <Input
              value={draft.tags.join(', ')}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </div>

        </div>
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => setDraftOpen(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? 'Save changes' : 'Add Meal'}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheet>

      <ResponsiveSheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} width="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Meal Details</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        {viewing && (
          <div className="space-y-4 mt-4 flex-1">
            <div>
              <h3 className="text-lg font-semibold">{viewing.name}</h3>
              {viewing.default_quantity && (
                <p className="text-sm text-muted-foreground">{viewing.default_quantity}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{viewing.dietary_type.replace('_', ' ')}</Badge>
              <Badge variant="outline">{viewing.cuisine.replace('_', ' ')}</Badge>
              <Badge variant="secondary">{viewing.meal_type}</Badge>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {([
                ['Calories', viewing.calories, 'kcal'],
                ['Protein', viewing.protein, 'g'],
                ['Carbs', viewing.carbs, 'g'],
                ['Fats', viewing.fats, 'g'],
                ['Fiber', viewing.fiber, 'g'],
              ] as const).map(([label, val, unit]) => (
                <div key={label} className="rounded-lg border p-2 text-center">
                  <p className="text-base font-bold">{val}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{label} ({unit})</p>
                </div>
              ))}
            </div>
            {viewing.micronutrients && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Key micronutrients</p>
                <p className="text-sm">{viewing.micronutrients}</p>
              </div>
            )}
            {viewing.tags?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {viewing.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {viewing.notes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{viewing.notes}</p>
              </div>
            )}
          </div>
        )}
        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          {viewing && (
            <Button onClick={() => { openEdit(viewing); setViewing(null); }}>
              <Edit className="h-4 w-4 mr-2" />Edit
            </Button>
          )}
        </ResponsiveSheetFooter>
      </ResponsiveSheet>

      <MealCatalogImportSheet
        open={importOpen}
        onOpenChange={setImportOpen}
        existingMeals={meals}
      />
    </AppLayout>

  );
}
