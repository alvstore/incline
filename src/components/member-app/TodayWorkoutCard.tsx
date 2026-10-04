import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Dumbbell, Pause, Play, Plus, RotateCcw, Timer, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { WorkoutDayEntry, WorkoutPlanContent } from '@/types/fitnessPlan';

function pickToday(content: WorkoutPlanContent | null): WorkoutDayEntry | null {
  const days = content?.days?.length ? content.days : content?.weeks?.[0]?.days ?? [];
  const usable = days.filter(d => d.exercises?.length);
  if (!usable.length) return null;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(new Date());
  const named = usable.find(d => d.day?.toLowerCase().includes(wd.toLowerCase()));
  if (named) return named;
  const idx = (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(wd) + 7) % 7;
  return usable[idx % usable.length];
}

export function TodayWorkoutCard({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['member-app-workout-plan', memberId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.from('member_fitness_plans').select('plan_name, plan_data')
        .eq('member_id', memberId).eq('plan_type', 'workout')
        .or(`valid_until.is.null,valid_until.gte.${today}`)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const today = useMemo(() => pickToday((data?.plan_data ?? null) as WorkoutPlanContent | null), [data]);

  if (isLoading) return <Skeleton className="h-44 rounded-2xl" />;

  return (
    <section aria-labelledby="today-workout" className="relative overflow-hidden rounded-2xl bg-foreground p-5 text-background shadow-xl shadow-slate-300/40 dark:bg-card dark:text-foreground dark:shadow-none">
      <div aria-hidden className="pointer-events-none absolute -right-12 -bottom-16 h-48 w-48 rounded-full bg-theme-gradient opacity-40 blur-2xl" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-70"><Zap className="h-3.5 w-3.5" aria-hidden />Today’s workout</p>
        {isError ? <p className="mt-3 text-sm opacity-80">Couldn’t load your plan right now.</p> : today ? (
          <>
            <h2 id="today-workout" className="mt-2 text-xl font-bold">{today.focus || today.label || today.day}</h2>
            <p className="mt-1 text-sm opacity-70">{today.exercises.length} exercises · {data?.plan_name || 'Your coach’s plan'}</p>
            <div className="mt-5 flex gap-2">
              <Button onClick={() => setOpen(true)} className="min-h-11 flex-1 bg-theme-gradient text-white hover:opacity-90"><Play className="mr-2 h-4 w-4" />Start workout</Button>
              <Button asChild variant="secondary" className="min-h-11"><Link to="/my-workout">Full plan</Link></Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="today-workout" className="mt-2 text-xl font-bold">No workout plan yet</h2>
            <p className="mt-1 text-sm opacity-70">Ask your coach for a personalised routine built around your goals.</p>
            <Button asChild className="mt-5 min-h-11 w-full bg-theme-gradient text-white hover:opacity-90"><Link to="/my-requests">Request a plan</Link></Button>
          </>
        )}
      </div>
      {today && <WorkoutSessionPlayer open={open} onOpenChange={setOpen} day={today} />}
    </section>
  );
}

function WorkoutSessionPlayer({ open, onOpenChange, day }: { open: boolean; onOpenChange: (o: boolean) => void; day: WorkoutDayEntry }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [rest, setRest] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running || rest <= 0) { if (rest <= 0) setRunning(false); return; }
    const t = setTimeout(() => setRest(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [running, rest]);

  const totalSets = day.exercises.reduce((n, e) => n + (Number(e.sets) || 1), 0);
  const doneSets = Object.values(done).filter(Boolean).length;
  const pct = Math.round((doneSets / totalSets) * 100);

  const toggle = (key: string, restSec: number) => {
    setDone(d => {
      const next = { ...d, [key]: !d[key] };
      if (next[key]) { setRest(restSec); setRunning(true); }
      return next;
    });
  };
  const mmss = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle>{day.focus || day.label || day.day}</SheetTitle>
          <SheetDescription>Tick each set as you finish it. Your rest timer starts automatically.</SheetDescription>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-theme-gradient transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{doneSets} of {totalSets} sets done</p>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {day.warmup && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Warm-up: </span>{day.warmup}</p>}
          {day.exercises.map((ex, i) => {
            const sets = Number(ex.sets) || 1;
            const restSec = ex.rest_seconds || parseInt(ex.rest || '', 10) || 90;
            return (
              <div key={i} className="rounded-2xl bg-card p-4 shadow-md shadow-slate-200/50 dark:shadow-none">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Dumbbell className="h-5 w-5" aria-hidden /></span>
                  <div className="min-w-0"><p className="font-semibold text-foreground">{ex.name}</p><p className="text-xs text-muted-foreground">{sets} sets{ex.reps ? ` × ${ex.reps}` : ''}{ex.weight ? ` · ${ex.weight}` : ''} · rest {restSec}s</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Array.from({ length: sets }, (_, s) => {
                    const key = `${i}-${s}`;
                    const on = !!done[key];
                    return (
                      <button key={key} type="button" onClick={() => toggle(key, restSec)} aria-pressed={on} aria-label={`${ex.name} set ${s + 1}`}
                        className={`flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'bg-theme-gradient text-white shadow-md shadow-primary/30' : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary'}`}>
                        {on ? <Check className="h-4 w-4" aria-hidden /> : s + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background p-4 pb-safe">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Timer className="h-5 w-5" aria-hidden /></span>
          <div className="flex-1"><p className="text-xs text-muted-foreground">Rest timer</p><p className="text-xl font-bold tabular-nums text-foreground" aria-live="polite">{mmss}</p></div>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Add 30 seconds" onClick={() => { setRest(r => r + 30); setRunning(true); }}><Plus className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label={running ? 'Pause timer' : 'Resume timer'} disabled={rest <= 0} onClick={() => setRunning(r => !r)}>{running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Reset timer" onClick={() => { setRest(0); setRunning(false); }}><RotateCcw className="h-4 w-4" /></Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
