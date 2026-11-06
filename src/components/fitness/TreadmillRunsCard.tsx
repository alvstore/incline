import { useQuery } from '@tanstack/react-query';
import { Footprints } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPace, formatDuration } from '@/lib/fitness/treadmill';

interface Props {
  memberId: string;
  /** Hide the card completely when there are no runs (member view). */
  hideWhenEmpty?: boolean;
}

export function TreadmillRunsCard({ memberId, hideWhenEmpty = true }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['treadmill-workouts', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('treadmill_workouts')
        .select('id, treadmill_code, start_time, duration_seconds, distance_meters, calories_burned, avg_incline_percent, avg_heart_rate, max_heart_rate')
        .eq('member_id', memberId)
        .order('start_time', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!isLoading && !isError && hideWhenEmpty && (data?.length ?? 0) === 0) return null;

  return (
    <Card className="rounded-xl border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Footprints className="h-5 w-5 text-primary" /> Cardio & Treadmill Runs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        {isError && <p className="text-sm text-destructive">Couldn't load runs. Please refresh.</p>}
        {!isLoading && !isError && data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No treadmill runs recorded yet.</p>
        )}
        {data?.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{new Date(r.start_time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              <span>{r.treadmill_code}</span>
            </div>
            <div className="mt-1 grid grid-cols-3 sm:grid-cols-6 gap-2 text-sm tabular-nums">
              <Stat label="Distance" value={`${(r.distance_meters / 1000).toFixed(2)} km`} />
              <Stat label="Time" value={formatDuration(r.duration_seconds)} />
              <Stat label="Calories" value={`${r.calories_burned} kcal`} />
              <Stat label="Pace" value={formatPace(r.duration_seconds, r.distance_meters)} />
              <Stat label="Incline" value={`${Number(r.avg_incline_percent ?? 0).toFixed(1)}%`} />
              <Stat label="Heart rate" value={r.avg_heart_rate ? `${r.avg_heart_rate}${r.max_heart_rate ? `/${r.max_heart_rate}` : ''} bpm` : '—'} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">{value}</p>
    </div>
  );
}
