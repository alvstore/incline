import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData, useTrainerData } from '@/hooks/useMemberData';
import { AlertCircle, CalendarCheck, Flame, LogOut, Timer, Trophy } from 'lucide-react';
import { format, eachMonthOfInterval, eachDayOfInterval, isAfter } from 'date-fns';
import { toast } from 'sonner';
import { PlanPageHero } from '@/components/member/plan/PlanPageHero';
import { AttendanceRangeSwitcher } from '@/components/member/attendance/AttendanceRangeSwitcher';
import { AttendanceHeatmap } from '@/components/member/attendance/AttendanceHeatmap';
import { AttendanceTrend, type TrendPoint } from '@/components/member/attendance/AttendanceTrend';
import { VisitLog } from '@/components/member/attendance/VisitLog';
import {
  computeStreaks, formatDuration, resolveBounds, shiftAnchor, visitsByDay,
  type AttendanceRange, type VisitRecord,
} from '@/components/member/attendance/attendanceRange';

export default function MyAttendance() {
  const queryClient = useQueryClient();
  const { member, isLoading: memberLoading } = useMemberData();
  const { trainer, isLoading: trainerLoading } = useTrainerData();
  const actor = member || trainer;
  
  const [range, setRange] = useState<AttendanceRange>('month');
  const [anchor, setAnchor] = useState(new Date());

  const bounds = useMemo(() => resolveBounds(range, anchor), [range, anchor]);

  const { data: attendance = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ['my-attendance', actor?.id, range, bounds.start?.toISOString() ?? 'all'],
    enabled: !!actor,
    queryFn: async () => {
      const isTrainer = !!trainer;
      const table = isTrainer ? 'staff_attendance' : 'member_attendance';
      const idColumn = isTrainer ? 'user_id' : 'member_id';

      let query = supabase
        .from(table as any)
        .select('id, check_in, check_out')
        .eq(idColumn, isTrainer ? actor.user_id : actor.id)
        .order('check_in', { ascending: false });

      if (bounds.start) {
        query = query.gte('check_in', bounds.start.toISOString()).lte('check_in', bounds.end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as VisitRecord[];
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: async (attendanceId: string) => {
      const isTrainer = !!trainer;
      const table = isTrainer ? 'staff_attendance' : 'member_attendance';
      
      const { error } = await supabase
        .from(table as any)
        .update({ check_out: new Date().toISOString() })
        .eq('id', attendanceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Checked out successfully');
      queryClient.invalidateQueries({ queryKey: ['my-attendance'] });
    },
    onError: (error: Error) => toast.error('Failed to check out: ' + error.message),
  });

  const activeSession = attendance.find((a) => !a.check_out);

  const visits = useMemo(() => visitsByDay(attendance), [attendance]);
  const uniqueDays = useMemo(() => new Set(visits.keys()), [visits]);
  const streaks = useMemo(() => computeStreaks(uniqueDays), [uniqueDays]);

  const avgMinutes = useMemo(() => {
    const durations = attendance
      .filter((a) => a.check_out)
      .map((a) => (new Date(a.check_out!).getTime() - new Date(a.check_in).getTime()) / 60000)
      .filter((m) => m > 0 && m < 8 * 60);
    if (durations.length === 0) return 0;
    return durations.reduce((s, m) => s + m, 0) / durations.length;
  }, [attendance]);

  // Effective window used by the heatmap/trend (all-time falls back to the data itself).
  const effectiveStart = useMemo(() => {
    if (bounds.start) return bounds.start;
    const earliest = attendance[attendance.length - 1]?.check_in;
    return earliest ? new Date(earliest) : new Date(bounds.end.getFullYear(), 0, 1);
  }, [bounds, attendance]);

  const trendPoints = useMemo<TrendPoint[]>(() => {
    if (range === 'month') {
      return eachDayOfInterval({ start: effectiveStart, end: bounds.end }).map((d) => ({
        label: format(d, 'd'),
        value: visits.get(format(d, 'yyyy-MM-dd')) || 0,
      }));
    }
    return eachMonthOfInterval({ start: effectiveStart, end: bounds.end }).map((m) => {
      const prefix = format(m, 'yyyy-MM');
      let total = 0;
      visits.forEach((count, day) => { if (day.startsWith(prefix)) total += count; });
      return { label: format(m, range === 'quarter' ? 'MMM' : 'MMM yy'), value: total };
    });
  }, [range, effectiveStart, bounds.end, visits]);

  const canStepForward = isAfter(new Date(), bounds.end);

  if (memberLoading || trainerLoading) {
    return (
      <AppLayout>
        <div className="space-y-4 p-1">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!actor) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <Card className="w-full max-w-lg rounded-2xl border-border/60 shadow-lg">
            <CardContent className="space-y-4 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10">
                <AlertCircle className="h-7 w-7 text-warning" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold">No member profile found</h1>
              <p className="text-sm text-muted-foreground">
                Your account is not linked to a member profile yet. Please contact the front desk.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-5 pb-8 p-1 sm:p-0">
        <PlanPageHero
          eyebrow="My attendance"
          title="Your training history"
          subtitle="Track every visit — by month, quarter, year or across your whole membership."
          action={
            activeSession ? (
              <Button
                variant="secondary"
                className="rounded-xl"
                disabled={checkOutMutation.isPending}
                onClick={() => checkOutMutation.mutate(activeSession.id)}
              >
                <LogOut className="mr-2 h-4 w-4" /> Check out
              </Button>
            ) : undefined
          }
          stats={[
            { icon: <CalendarCheck className="h-3.5 w-3.5" />, label: 'Visits', value: String(attendance.length) },
            { icon: <Flame className="h-3.5 w-3.5" />, label: 'Current streak', value: `${streaks.current}d` },
            { icon: <Trophy className="h-3.5 w-3.5" />, label: 'Best streak', value: `${streaks.best}d` },
            { icon: <Timer className="h-3.5 w-3.5" />, label: 'Avg session', value: formatDuration(avgMinutes) },
          ]}
        />

        <AttendanceRangeSwitcher
          range={range}
          onRangeChange={setRange}
          periodLabel={bounds.label}
          onStep={(dir) => setAnchor((prev) => shiftAnchor(range, prev, dir))}
          canStepForward={canStepForward}
        />

        {attendanceLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-72 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            <AttendanceHeatmap
              start={effectiveStart}
              end={bounds.end}
              visits={visits}
              mode={range === 'month' ? 'grid' : 'compact'}
              title={`Visit calendar · ${bounds.label}`}
            />
            <AttendanceTrend
              points={trendPoints}
              title={range === 'month' ? 'Visits per day' : 'Visits per month'}
            />
            <VisitLog records={attendance} />
          </>
        )}
      </div>
    </AppLayout>
  );
}
