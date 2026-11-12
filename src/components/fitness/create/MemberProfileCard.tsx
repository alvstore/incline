import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, User, Pencil, Save, Loader2 } from 'lucide-react';

export interface MemberProfileOverrides {
  age?: string;
  gender?: string;
  weight?: string;
  height?: string;
  fitness_level?: string;
  equipment?: string;
  dietary_preference?: string;
  cuisine?: string;
  allergies?: string;
  health_conditions?: string;
  fitness_goals?: string;
  /** Workout-only: activities the member wants included (warm up, cardio, etc). */
  workout_activities?: string[];
}

interface Props {
  memberId: string;
  value: MemberProfileOverrides;
  onChange: (next: MemberProfileOverrides) => void;
  /** Controls which sport/diet specific fields are shown. Defaults to 'workout'. */
  planType?: 'workout' | 'diet';
}

const WORKOUT_ACTIVITY_OPTIONS = [
  'Warm Up',
  'Dynamic Stretching',
  'Cardio',
  'Strength',
  'Functional Training',
  'CrossFit',
  'HIIT',
  'Plyometrics',
  'Mobility',
  'Cool Down',
];

function calcAge(dob?: string | null): string {
  if (!dob) return '';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const ageDt = new Date(diffMs);
  return String(Math.abs(ageDt.getUTCFullYear() - 1970));
}

function calcBmi(w?: string, h?: string): string | null {
  const wn = parseFloat(w || '');
  const hn = parseFloat(h || '');
  if (!wn || !hn) return null;
  const meters = hn / 100;
  if (meters <= 0) return null;
  return (wn / (meters * meters)).toFixed(1);
}

function arrToCsv(arr?: string[] | null): string {
  if (!arr || arr.length === 0) return '';
  return arr.join(', ');
}

function csvToArr(csv?: string): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function MemberProfileCard({ memberId, value, onChange, planType = 'workout' }: Props) {
  const isWorkout = planType === 'workout';
  const toggleActivity = (label: string) => {
    const cur = value.workout_activities || [];
    const next = cur.includes(label) ? cur.filter((a) => a !== label) : [...cur, label];
    onChange({ ...value, workout_activities: next });
  };
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedEquipmentExtras, setSavedEquipmentExtras] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // Pull base member info + latest measurement + saved fitness profile
  const { data, isLoading } = useQuery({
    queryKey: ['member-profile-prefill', memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data: member } = await supabase
        .from('members')
        .select(
          'id, user_id, health_conditions, fitness_goals, fitness_level, equipment_availability, dietary_preference, cuisine_preference, allergies, workout_activities, profiles:user_id(gender, date_of_birth, full_name)'
        )
        .eq('id', memberId)
        .maybeSingle();
      const { data: meas } = await supabase
        .from('member_measurements')
        .select('weight_kg, height_cm, recorded_at')
        .eq('member_id', memberId)
        .order('recorded_at', { ascending: false })
        .limit(1);
      const m = (meas || [])[0];
      const profile = (member as any)?.profiles;
      const equipArr = ((member as any)?.equipment_availability as string[] | null) || [];
      return {
        equipmentArr: equipArr,
        gender: (profile?.gender || '').toLowerCase(),
        age: calcAge(profile?.date_of_birth),
        weight: m?.weight_kg ? String(m.weight_kg) : '',
        height: m?.height_cm ? String(m.height_cm) : '',
        health_conditions: (member as any)?.health_conditions || '',
        fitness_goals: (member as any)?.fitness_goals || '',
        fitness_level: (member as any)?.fitness_level || '',
        equipment: equipArr[0] || '',
        dietary_preference: (member as any)?.dietary_preference || '',
        cuisine: (member as any)?.cuisine_preference || '',
        allergies: arrToCsv((member as any)?.allergies),
        workout_activities: ((member as any)?.workout_activities as string[] | null) || [],
      };
    },
  });

  // Hydrate once when data arrives — does not mutate the saved profile,
  // only seeds the form state for this plan.
  useEffect(() => {
    if (!data || hydrated) return;
    setSavedEquipmentExtras((data.equipmentArr || []).slice(1));
    onChange({
      age: value.age || data.age,
      gender: value.gender || data.gender,
      weight: value.weight || data.weight,
      height: value.height || data.height,
      health_conditions: value.health_conditions ?? data.health_conditions,
      fitness_goals: value.fitness_goals ?? data.fitness_goals,
      fitness_level: value.fitness_level || data.fitness_level,
      equipment: value.equipment || data.equipment,
      dietary_preference: value.dietary_preference || data.dietary_preference,
      cuisine: value.cuisine || data.cuisine,
      allergies: value.allergies ?? data.allergies,
      workout_activities: value.workout_activities && value.workout_activities.length > 0
        ? value.workout_activities
        : data.workout_activities,
    });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hydrated]);

  const set = (k: keyof MemberProfileOverrides) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const setSel = (k: keyof MemberProfileOverrides) => (v: string) => onChange({ ...value, [k]: v });

  const bmi = calcBmi(value.weight, value.height);

  const handleSaveToProfile = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      // Preserve any saved equipment entries beyond the first slot so the
      // single-select UI does not silently drop multi-value data.
      const equipment_availability = value.equipment
        ? [value.equipment, ...savedEquipmentExtras.filter((e) => e !== value.equipment)]
        : savedEquipmentExtras;
      const update = {
        fitness_level: value.fitness_level || null,
        equipment_availability,
        dietary_preference: value.dietary_preference || null,
        cuisine_preference: value.cuisine || null,
        allergies: csvToArr(value.allergies),
        health_conditions: value.health_conditions || null,
        fitness_goals: value.fitness_goals || null,
        workout_activities: value.workout_activities || [],
      } satisfies Partial<Database['public']['Tables']['members']['Update']>;
      const { error } = await supabase.from('members').update(update).eq('id', memberId);
      if (error) throw error;
      toast.success('Saved to member profile');
      await queryClient.invalidateQueries({ queryKey: ['member-profile-prefill', memberId] });
      await queryClient.invalidateQueries({ queryKey: ['member', memberId] });
    } catch (err: any) {
      // Log full error so we can diagnose silent column-not-found / RLS failures.
      console.error('[MemberProfileCard] save failed', err);
      toast.error(err?.message || err?.details || 'Failed to save member profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Member Profile
            {isLoading && <Badge variant="outline" className="text-xs">Loading…</Badge>}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1.5 h-8"
            onClick={handleSaveToProfile}
            disabled={saving || isLoading}
            title="Save current values to the member's permanent profile"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Read-only summary chips */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Age: {value.age || '—'}</Badge>
          <Badge variant="secondary">Gender: {value.gender || '—'}</Badge>
          <Badge variant="secondary">Weight: {value.weight ? `${value.weight} kg` : '—'}</Badge>
          <Badge variant="secondary">Height: {value.height ? `${value.height} cm` : '—'}</Badge>
          <Badge variant="secondary">BMI: {bmi || '—'}</Badge>
          {value.fitness_level && <Badge variant="outline">Level: {value.fitness_level}</Badge>}
          {!isWorkout && value.dietary_preference && <Badge variant="outline">Diet: {value.dietary_preference}</Badge>}
          {isWorkout && value.workout_activities && value.workout_activities.length > 0 && (
            <Badge variant="outline">Activities: {value.workout_activities.length}</Badge>
          )}
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <Pencil className="h-3.5 w-3.5" />
              {open ? 'Hide profile data' : 'Edit profile data for this plan'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Changes apply only to this plan. Use “Save to member profile” to persist them so they pre-fill next time.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Age</Label>
                <Input value={value.age || ''} onChange={set('age')} type="number" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Gender</Label>
                <Select value={value.gender || ''} onValueChange={setSel('gender')}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fitness Level</Label>
                <Select value={value.fitness_level || ''} onValueChange={setSel('fitness_level')}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Weight (kg)</Label>
                <Input type="number" value={value.weight || ''} onChange={set('weight')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Height (cm)</Label>
                <Input type="number" value={value.height || ''} onChange={set('height')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">BMI</Label>
                <Input value={bmi || ''} disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Equipment Access</Label>
                <Select value={value.equipment || ''} onValueChange={setSel('equipment')}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_gym">Full Gym</SelectItem>
                    <SelectItem value="home_basic">Home (basic)</SelectItem>
                    <SelectItem value="home_dumbbells">Home (dumbbells)</SelectItem>
                    <SelectItem value="bodyweight">Bodyweight only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!isWorkout && (
                <div className="space-y-1">
                  <Label className="text-xs">Dietary Preference</Label>
                  <Select value={value.dietary_preference || ''} onValueChange={setSel('dietary_preference')}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vegetarian">Vegetarian</SelectItem>
                      <SelectItem value="vegan">Vegan</SelectItem>
                      <SelectItem value="non_vegetarian">Non-Vegetarian</SelectItem>
                      <SelectItem value="eggetarian">Eggetarian</SelectItem>
                      <SelectItem value="pescatarian">Pescatarian</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!isWorkout && (
                <div className="space-y-1">
                  <Label className="text-xs">Cuisine</Label>
                  <Select value={value.cuisine || ''} onValueChange={setSel('cuisine')}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="indian">Indian</SelectItem>
                      <SelectItem value="continental">Continental</SelectItem>
                      <SelectItem value="mediterranean">Mediterranean</SelectItem>
                      <SelectItem value="asian">Asian</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {isWorkout && (
              <div className="space-y-1.5">
                <Label className="text-xs">Workout Activities (select all that apply)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WORKOUT_ACTIVITY_OPTIONS.map((opt) => {
                    const active = (value.workout_activities || []).includes(opt);
                    return (
                      <button aria-pressed={active}
                        type="button"
                        key={opt}
                        onClick={() => toggleActivity(opt)}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-foreground border-input hover:bg-muted'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  AI will structure each session as Warm Up → Main → Cool Down using these.
                </p>
              </div>
            )}

            {!isWorkout && (
              <div className="space-y-1">
                <Label className="text-xs">Allergies</Label>
                <Input value={value.allergies || ''} onChange={set('allergies')} placeholder="e.g. nuts, dairy, gluten" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Health Conditions</Label>
              <Textarea
                value={value.health_conditions || ''}
                onChange={set('health_conditions')}
                rows={2}
                placeholder="Injuries or limitations to consider"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fitness Goals</Label>
              <Textarea
                value={value.fitness_goals || ''}
                onChange={set('fitness_goals')}
                rows={2}
                placeholder="Lose fat, build strength, improve endurance…"
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={handleSaveToProfile}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save to member profile
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
