import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { PtStatusBadge } from '@/components/pt/PtStatusBadge';
import { Download, Search, ClipboardCheck, Loader2 } from 'lucide-react';
import { exportToCSV } from '@/lib/csvExport';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

type Row = {
  id: string;
  scheduled_at: string;
  status: string;
  notes: string | null;
  member_name: string;
  member_code: string;
  trainer_name: string;
  package_name: string;
};

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'today', label: 'Today' },
];

export default function PtAttendance() {
  const { selectedBranch } = useBranchContext();
  const { roles } = useAuth();
  const isTrainerOnly = roles.length > 0 && roles.every(r => r.role === 'trainer');

  const [range, setRange] = useState('30');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (range === 'today') return { from: startOfDay(now), to: endOfDay(now) };
    return { from: subDays(now, parseInt(range, 10)), to: now };
  }, [range]);

  useRealtimeInvalidate({
    channel: 'pt-attendance-roster',
    tables: ['pt_sessions'],
    invalidateKeys: [['pt-attendance-roster']],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pt-attendance-roster', selectedBranch?.id ?? 'all', from.toISOString(), to.toISOString(), statusFilter],
    queryFn: async (): Promise<Row[]> => {
      let q = supabase
        .from('pt_sessions')
        .select('id, scheduled_at, status, notes, trainer_id, member_pt_package_id, branch_id')
        .gte('scheduled_at', from.toISOString())
        .lte('scheduled_at', to.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(1000);
      if (selectedBranch?.id) q = q.eq('branch_id', selectedBranch !== 'all' ? selectedBranch : undefined);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter as any);
      const { data, error } = await q;
      if (error) throw error;

      const sessions = data || [];
      if (sessions.length === 0) return [];

      const pkgIds = [...new Set(sessions.map(s => s.member_pt_package_id))];
      const trainerIds = [...new Set(sessions.map(s => s.trainer_id).filter(Boolean) as string[])];

      const [pkgsRes, trainersRes] = await Promise.all([
        supabase.from('member_pt_packages')
          .select('id, member_id, package:pt_packages(name)')
          .in('id', pkgIds),
        supabase.from('trainers').select('id, user_id').in('id', trainerIds),
      ]);

      const pkgs = pkgsRes.data || [];
      const trainers = trainersRes.data || [];
      const memberIds = [...new Set(pkgs.map(p => p.member_id))];
      const trainerUserIds = trainers.map(t => t.user_id).filter(Boolean) as string[];
      const allUserIds = [...new Set(trainerUserIds)];

      const [membersRes, profilesRes] = await Promise.all([
        supabase.from('members').select('id, member_code, user_id').in('id', memberIds),
        supabase.from('profiles').select('id, full_name')
          .in('id', allUserIds.concat(
            // append member user_ids after we load them
            [] as string[]
          )),
      ]);
      const members = membersRes.data || [];
      const memberUserIds = members.map(m => m.user_id).filter(Boolean) as string[];
      const { data: memberProfiles } = await supabase
        .from('profiles').select('id, full_name')
        .in('id', memberUserIds);

      const profileNames: Record<string, string> = {};
      (profilesRes.data || []).forEach(p => { profileNames[p.id] = p.full_name || ''; });
      (memberProfiles || []).forEach(p => { profileNames[p.id] = p.full_name || ''; });

      const pkgMap = new Map(pkgs.map(p => [p.id, p]));
      const trainerMap = new Map(trainers.map(t => [t.id, t]));
      const memberMap = new Map(members.map(m => [m.id, m]));

      return sessions.map(s => {
        const pkg: any = pkgMap.get(s.member_pt_package_id);
        const member: any = pkg ? memberMap.get(pkg.member_id) : null;
        const trainer: any = s.trainer_id ? trainerMap.get(s.trainer_id) : null;
        const memberName = member?.user_id ? (profileNames[member.user_id] || member.member_code) : (member?.member_code || 'Unknown');
        const trainerName = trainer?.user_id ? (profileNames[trainer.user_id] || 'Trainer') : 'Unknown';
        return {
          id: s.id,
          scheduled_at: s.scheduled_at,
          status: s.status,
          notes: s.notes,
          member_name: memberName,
          member_code: member?.member_code || '',
          trainer_name: trainerName,
          package_name: pkg?.package?.name || '—',
        };
      });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.member_name.toLowerCase().includes(q) ||
      r.member_code.toLowerCase().includes(q) ||
      r.trainer_name.toLowerCase().includes(q) ||
      r.package_name.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const handleExport = () => {
    exportToCSV(
      filtered.map(r => ({
        Date: format(new Date(r.scheduled_at), 'yyyy-MM-dd HH:mm'),
        Member: r.member_name,
        MemberCode: r.member_code,
        Trainer: r.trainer_name,
        Package: r.package_name,
        Status: r.status,
        Notes: r.notes ?? '',
      })),
      `pt-attendance-${format(new Date(), 'yyyy-MM-dd')}.csv`
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-7 w-7 text-indigo-600" />
              PT Attendance
            </h1>
            <p className="text-muted-foreground">
              {isTrainerOnly ? 'Your personal training session attendance.' : 'Attendance logged across all trainers in this branch.'}
            </p>
          </div>
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>

        <Card className="rounded-2xl shadow-sm border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs font-medium text-slate-600">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Member, trainer or package…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Range</label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Present</SelectItem>
                  <SelectItem value="late">Late</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm border-border/50">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                No PT attendance records in this range.
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Trainer</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50">
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium text-slate-900">{format(new Date(r.scheduled_at), 'dd MMM yyyy')}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(r.scheduled_at), 'HH:mm')}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.member_name}</div>
                        {r.member_code && <div className="text-xs text-muted-foreground">{r.member_code}</div>}
                      </TableCell>
                      <TableCell>{r.trainer_name}</TableCell>
                      <TableCell>{r.package_name}</TableCell>
                      <TableCell><PtStatusBadge status={r.status} /></TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{r.notes ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
