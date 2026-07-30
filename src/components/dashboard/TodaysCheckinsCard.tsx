import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { format } from 'date-fns';
import { Users, UserCog, IndianRupee, CalendarClock, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQueryClient } from '@tanstack/react-query';

interface CheckinRow {
  person_kind: 'member' | 'staff';
  person_id: string;
  full_name: string | null;
  avatar_url: string | null;
  member_code: string | null;
  role_label: string | null;
  branch_id: string | null;
  check_in: string;
  check_out: string | null;
  dues: number | null;
  days_remaining: number | null;
}

interface Props {
  branchId?: string;
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
}

function PersonRow({ row }: { row: CheckinRow }) {
  const dues = Number(row.dues ?? 0);
  const days = row.days_remaining;
  return (
    <li className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-slate-50">
      <Avatar className="h-9 w-9">
        {row.avatar_url ? <AvatarImage src={row.avatar_url} alt={row.full_name ?? 'Member'} /> : null}
        <AvatarFallback className="bg-indigo-50 text-xs font-semibold text-indigo-600">
          {initials(row.full_name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{row.full_name || 'Unknown'}</p>
        <p className="truncate text-xs text-slate-500">
          {row.person_kind === 'member'
            ? row.member_code ?? 'Member'
            : (row.role_label ?? 'staff').replace(/^\w/, (c) => c.toUpperCase())}
          {' · '}
          {format(new Date(row.check_in), 'hh:mm a')}
          {row.check_out ? ` – ${format(new Date(row.check_out), 'hh:mm a')}` : ''}
        </p>
      </div>

      {row.person_kind === 'member' && (
        <div className="flex shrink-0 items-center gap-1.5">
          {dues > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
              <IndianRupee className="h-3 w-3" aria-hidden />
              {Math.round(dues).toLocaleString('en-IN')}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              Paid
            </span>
          )}
          {typeof days === 'number' && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                days < 0
                  ? 'bg-red-100 text-red-700'
                  : days <= 7
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              <CalendarClock className="h-3 w-3" aria-hidden />
              {days < 0 ? 'Expired' : `${days}d left`}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export default function TodaysCheckinsCard({ branchId }: Props) {
  const qc = useQueryClient();

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['todays-checkins', branchId ?? 'all'],
    queryFn: async (): Promise<CheckinRow[]> => {
      const { data, error } = await supabase.rpc('get_todays_checkins', {
        _branch_id: branchId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as unknown as CheckinRow[];
    },
    refetchInterval: 30_000,
  });

  // Realtime — attendance tables are published; refresh on any change.
  useEffect(() => {
    const ch = supabase
      .channel('todays-checkins')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_attendance' }, () =>
        qc.invalidateQueries({ queryKey: ['todays-checkins'] }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_attendance' }, () =>
        qc.invalidateQueries({ queryKey: ['todays-checkins'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const members = data.filter((r) => r.person_kind === 'member');
  const staff = data.filter((r) => r.person_kind === 'staff');

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-emerald-500" aria-hidden />
          Today&apos;s Check-ins
          <span className="ml-auto text-xs font-semibold uppercase tracking-wider text-slate-500">
            {data.length} today
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-slate-500">Could not load today&apos;s check-ins.</p>
        ) : (
          <Tabs defaultValue="members">
            <TabsList className="mb-3">
              <TabsTrigger value="members" className="cursor-pointer gap-1.5">
                <Users className="h-3.5 w-3.5" aria-hidden />
                Members ({members.length})
              </TabsTrigger>
              <TabsTrigger value="staff" className="cursor-pointer gap-1.5">
                <UserCog className="h-3.5 w-3.5" aria-hidden />
                Staff &amp; Trainers ({staff.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="members">
              {members.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No member check-ins yet today.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {members.map((r) => (
                    <PersonRow key={`m-${r.person_id}`} row={r} />
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="staff">
              {staff.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No staff check-ins yet today.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {staff.map((r) => (
                    <PersonRow key={`s-${r.person_id}`} row={r} />
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
