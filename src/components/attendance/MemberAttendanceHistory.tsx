/**
 * MemberAttendanceHistory — month view of member visits for a branch.
 * Summary cards per member (visits, last visit, average duration) plus a
 * searchable day-by-day log.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Search, History, AlertTriangle, CalendarDays } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Visit = {
  id: string;
  member_id: string;
  check_in: string;
  check_out: string | null;
  check_in_method: string | null;
  name: string;
  code: string;
  avatar_url: string | null;
};

function initials(name?: string | null) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function durationLabel(inIso: string, outIso: string | null) {
  if (!outIso) return 'Open';
  const mins = (new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000;
  if (mins <= 0 || mins > 16 * 60) return '—';
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

export function MemberAttendanceHistory({ branchId }: { branchId: string | undefined }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [search, setSearch] = useState('');

  const { data: visits = [], isLoading, isError } = useQuery({
    queryKey: ['member-attendance-history', branchId, month],
    enabled: !!branchId,
    queryFn: async (): Promise<Visit[]> => {
      const [year, m] = month.split('-').map(Number);
      const start = `${month}-01T00:00:00`;
      const end = new Date(year, m, 0, 23, 59, 59, 999).toISOString();

      const { data, error } = await supabase
        .from('member_attendance')
        .select('id, member_id, check_in, check_out, check_in_method')
        .eq('branch_id', branchId!)
        .gte('check_in', start)
        .lte('check_in', end)
        .order('check_in', { ascending: false });
      if (error) throw error;

      const rows = data || [];
      const memberIds = [...new Set(rows.map((r) => r.member_id).filter(Boolean))] as string[];
      if (memberIds.length === 0) return [];

      const { data: members } = await supabase
        .from('members')
        .select('id, member_code, user_id')
        .in('id', memberIds);
      const userIds = (members || []).map((m2) => m2.user_id).filter(Boolean) as string[];
      const { data: profiles } = userIds.length
        ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds)
        : { data: [] as { id: string; full_name: string | null; avatar_url: string | null }[] };

      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const memberMap = new Map((members || []).map((m2) => [m2.id, m2]));

      return rows.map((r) => {
        const mem = memberMap.get(r.member_id as string);
        const prof = mem?.user_id ? profileMap.get(mem.user_id) : undefined;
        return {
          ...r,
          name: prof?.full_name || 'Unknown member',
          code: mem?.member_code || '—',
          avatar_url: prof?.avatar_url || null,
        } as Visit;
      });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter((v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q));
  }, [visits, search]);

  const summary = useMemo(() => {
    const map = new Map<string, { name: string; code: string; avatar: string | null; visits: number; days: Set<string>; minutes: number; last: string }>();
    for (const v of filtered) {
      const cur = map.get(v.member_id) ?? {
        name: v.name, code: v.code, avatar: v.avatar_url, visits: 0, days: new Set<string>(), minutes: 0, last: v.check_in,
      };
      cur.visits += 1;
      cur.days.add(format(parseISO(v.check_in), 'yyyy-MM-dd'));
      if (v.check_out) {
        const mins = (new Date(v.check_out).getTime() - new Date(v.check_in).getTime()) / 60000;
        if (mins > 0 && mins < 16 * 60) cur.minutes += mins;
      }
      if (new Date(v.check_in) > new Date(cur.last)) cur.last = v.check_in;
      map.set(v.member_id, cur);
    }
    return Array.from(map.entries())
      .map(([id, d]) => ({ id, ...d, uniqueDays: d.days.size }))
      .sort((a, b) => b.visits - a.visits);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="member-history-month" className="text-xs text-muted-foreground">Month</Label>
            <Input
              id="member-history-month" type="month" value={month}
              onChange={(e) => setMonth(e.target.value)} className="h-9 w-[170px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-history-search" className="text-xs text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="member-history-search" placeholder="Name or member code"
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-[220px] pl-9"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} visit{filtered.length === 1 ? '' : 's'} · {summary.length} member{summary.length === 1 ? '' : 's'}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 opacity-50" />
          Could not load member attendance for this month.
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <History className="mx-auto mb-3 h-8 w-8 opacity-50" />
          No member visits recorded for this month.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {summary.slice(0, 12).map((s) => (
              <Card key={s.id} className="rounded-2xl border-0 shadow-lg shadow-muted/40 transition-all duration-200 hover:shadow-xl">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={s.avatar || undefined} />
                      <AvatarFallback className="bg-accent/10 text-sm font-semibold text-accent">{initials(s.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.code}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-success/10 p-2 text-center">
                      <p className="text-lg font-bold text-success">{s.visits}</p>
                      <p className="text-xs text-muted-foreground">Visits</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2 text-center">
                      <p className="text-lg font-bold text-foreground">{s.uniqueDays}</p>
                      <p className="text-xs text-muted-foreground">Days</p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2 text-center">
                      <p className="text-lg font-bold text-foreground">
                        {s.visits ? Math.round(s.minutes / s.visits) : 0}m
                      </p>
                      <p className="text-xs text-muted-foreground">Avg stay</p>
                    </div>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Last visit {format(parseISO(s.last), 'd MMM, h:mm a')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="rounded-2xl border-0 shadow-lg shadow-muted/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 200).map((v) => (
                    <TableRow key={v.id} className="transition-colors duration-150 hover:bg-muted/40">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={v.avatar_url || undefined} />
                            <AvatarFallback className="bg-accent/10 text-xs text-accent">{initials(v.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{v.name}</p>
                            <p className="text-xs text-muted-foreground">{v.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{format(parseISO(v.check_in), 'd MMM yyyy')}</TableCell>
                      <TableCell className="text-sm">{format(parseISO(v.check_in), 'h:mm a')}</TableCell>
                      <TableCell className="text-sm">{v.check_out ? format(parseISO(v.check_out), 'h:mm a') : '—'}</TableCell>
                      <TableCell className="text-sm">{durationLabel(v.check_in, v.check_out)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full text-[11px] capitalize">
                          {(v.check_in_method || 'manual').replace('_', ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 200 && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  Showing the 200 most recent of {filtered.length} visits — narrow the search to see more.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
