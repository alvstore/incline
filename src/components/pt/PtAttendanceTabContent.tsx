import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format, startOfWeek, addDays, addWeeks, isSameDay,
  startOfDay, endOfDay, subDays,
} from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ChevronLeft, ChevronRight, Users, CheckCircle2, Loader2, ChevronDown,
  ChevronUp, Download, Search, Info,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { PtPackageBadge } from '@/components/pt/PtPackageBadge';
import { PtStatusBadge } from '@/components/pt/PtStatusBadge';
import { MarkPtStatusMenu } from '@/components/pt/MarkPtStatusMenu';
import { logPtSession } from '@/services/ptService';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { toast } from 'sonner';
import { exportToCSV } from '@/lib/csvExport';
import { useMutation } from '@tanstack/react-query';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Trainer = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  branch_id: string;
};

type ClientCard = {
  pkgId: string;
  memberId: string;
  memberName: string;
  memberCode: string;
  avatarUrl: string | null;
  packageName: string;
  packageType: 'session_based' | 'monthly';
  sessionsRemaining: number;
  sessionsTotal: number;
  expiryDate: string | null;
};

type SessionRow = {
  id: string;
  status: string;
  scheduled_at: string;
  member_pt_package_id: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Week strip
// ─────────────────────────────────────────────────────────────────────────────
function WeekStrip({
  selected, onSelect,
}: { selected: Date; onSelect: (d: Date) => void }) {
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(selected, { weekStartsOn: 1 }));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  const today = new Date();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline" size="icon"
        className="h-9 w-9 shrink-0 rounded-full"
        onClick={() => setAnchor(addWeeks(anchor, -1))}
        aria-label="Previous week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {days.map((d) => {
          const isSelected = isSameDay(d, selected);
          const isToday = isSameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              className={cn(
                'flex flex-col items-center justify-center min-w-[60px] sm:min-w-[72px] py-2 px-3 rounded-2xl border transition-all',
                'focus:outline-none focus:ring-2 focus:ring-indigo-500',
                isSelected
                  ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white border-transparent shadow-lg shadow-indigo-500/30'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40',
              )}
            >
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wider',
                isSelected ? 'text-white/80' : 'text-slate-500',
              )}>
                {format(d, 'EEE')}
              </span>
              <span className="text-lg font-bold leading-tight">{format(d, 'd')}</span>
              <span className={cn(
                'text-[10px]',
                isSelected ? 'text-white/70' : 'text-slate-400',
              )}>
                {format(d, 'MMM')}
              </span>
              {isToday && !isSelected && (
                <span className="mt-0.5 h-1 w-1 rounded-full bg-indigo-500" />
              )}
            </button>
          );
        })}
      </div>
      <Button
        variant="outline" size="icon"
        className="h-9 w-9 shrink-0 rounded-full"
        onClick={() => setAnchor(addWeeks(anchor, 1))}
        aria-label="Next week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost" size="sm"
        className="hidden sm:inline-flex text-xs"
        onClick={() => { onSelect(today); setAnchor(startOfWeek(today, { weekStartsOn: 1 })); }}
      >
        Today
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Trainer rail
// ─────────────────────────────────────────────────────────────────────────────
function TrainerRail({
  trainers, selectedId, onSelect, isLoading,
}: {
  trainers: Trainer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (trainers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No active trainers in this branch.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {trainers.map((t) => {
        const initials = (t.full_name || 'T').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const active = selectedId === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={cn(
              'w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left group',
              'focus:outline-none focus:ring-2 focus:ring-indigo-500',
              active
                ? 'bg-indigo-50 ring-1 ring-indigo-200 shadow-sm shadow-indigo-500/10'
                : 'hover:bg-slate-50',
            )}
          >
            <div className={cn(
              'h-1 w-1 rounded-full transition-all',
              active ? 'bg-indigo-600 h-10 w-1' : 'bg-transparent',
            )} />
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={t.avatar_url ?? undefined} />
              <AvatarFallback className={active ? 'bg-indigo-100 text-indigo-700' : ''}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm font-medium truncate',
                active ? 'text-indigo-900' : 'text-slate-700',
              )}>
                {t.full_name || 'Trainer'}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Client roster card
// ─────────────────────────────────────────────────────────────────────────────
function ClientRosterCard({
  client, trainerId, session, canMark, selectedDate, invalidateKeys,
}: {
  client: ClientCard;
  trainerId: string;
  session: SessionRow | undefined;
  canMark: boolean;
  selectedDate: Date;
  invalidateKeys: any[][];
}) {
  const qc = useQueryClient();
  const initials = (client.memberName || 'M').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const isToday = isSameDay(selectedDate, new Date());

  const markPresent = useMutation({
    mutationFn: () => logPtSession({
      memberPackageId: client.pkgId,
      trainerId,
      status: 'present',
    }),
    onSuccess: (res: any) => {
      const left = res?.sessions_remaining;
      toast.success(
        `Session logged for ${client.memberName}` +
        (typeof left === 'number' ? ` · ${left} sessions left` : ''),
      );
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Could not log session');
    },
  });

  const status = session?.status;
  const isLogged = !!status && status !== 'scheduled';
  const isCompletedish = status === 'completed' || status === 'late';

  return (
    <div className={cn(
      'group relative rounded-2xl bg-white shadow-lg shadow-slate-200/50 p-4 transition-all',
      'hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-0.5',
      isCompletedish && 'ring-1 ring-emerald-200 bg-gradient-to-br from-emerald-50/40 to-white',
    )}>
      <div className="flex items-start gap-3">
        <Avatar className="h-11 w-11 shrink-0 ring-2 ring-white shadow-sm">
          <AvatarImage src={client.avatarUrl ?? undefined} />
          <AvatarFallback className="bg-indigo-100 text-indigo-700 font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 truncate leading-tight">
            {client.memberName}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {client.memberCode} · {client.packageName}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <PtPackageBadge
          packageType={client.packageType}
          sessionsRemaining={client.sessionsRemaining}
          sessionsTotal={client.sessionsTotal}
          expiryDate={client.expiryDate}
        />
      </div>

      <div className="mt-4">
        {isLogged ? (
          <div className="flex items-center justify-between gap-2">
            <PtStatusBadge status={status!} />
            {session?.scheduled_at && (
              <span className="text-xs text-slate-400">
                {format(new Date(session.scheduled_at), 'HH:mm')}
              </span>
            )}
          </div>
        ) : canMark ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => markPresent.mutate()}
              disabled={markPresent.isPending || !isToday}
              className={cn(
                'flex-1 h-10 rounded-xl font-semibold shadow-md shadow-indigo-500/20',
                'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700',
              )}
            >
              {markPresent.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Mark Present
                </>
              )}
            </Button>
            <MarkPtStatusMenu
              memberPackageId={client.pkgId}
              trainerId={trainerId}
              memberName={client.memberName}
              invalidateKeys={invalidateKeys}
            />
          </div>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-slate-50 text-slate-400 text-xs cursor-not-allowed">
                  <Info className="h-3.5 w-3.5" />
                  View only
                </div>
              </TooltipTrigger>
              <TooltipContent>
                Staff cannot log PT sessions. Ask a manager or trainer.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {!isLogged && !isToday && canMark && (
          <p className="mt-1.5 text-[11px] text-slate-400 text-center">
            Marking is only available for today
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History (legacy table, collapsible)
// ─────────────────────────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

function HistoryPanel({ trainerFilterDefault }: { trainerFilterDefault: string }) {
  const { selectedBranch } = useBranchContext();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('30');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [trainerFilter, setTrainerFilter] = useState<string>(trainerFilterDefault);
  const [search, setSearch] = useState('');

  const { from, to } = useMemo(() => {
    const now = new Date();
    return { from: subDays(now, parseInt(range, 10)), to: now };
  }, [range]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pt-attendance-history', selectedBranch, from.toISOString(), to.toISOString(), statusFilter],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from('pt_sessions')
        .select('id, scheduled_at, status, notes, trainer_id, member_pt_package_id, branch_id')
        .gte('scheduled_at', from.toISOString())
        .lte('scheduled_at', to.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(500);
      if (selectedBranch && selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
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

      const [membersRes, trainerProfilesRes] = await Promise.all([
        supabase.from('members').select('id, member_code, user_id').in('id', memberIds),
        supabase.from('profiles').select('id, full_name').in('id', trainerUserIds),
      ]);
      const members = membersRes.data || [];
      const memberUserIds = members.map(m => m.user_id).filter(Boolean) as string[];
      const { data: memberProfiles } = await supabase
        .from('profiles').select('id, full_name')
        .in('id', memberUserIds);

      const profileNames: Record<string, string> = {};
      (trainerProfilesRes.data || []).forEach(p => { profileNames[p.id] = p.full_name || ''; });
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
          trainer_id: s.trainer_id,
          package_name: pkg?.package?.name || '—',
        };
      });
    },
  });

  const trainerOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => { if (r.trainer_id) map.set(r.trainer_id, r.trainer_name); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (trainerFilter !== 'all') out = out.filter(r => r.trainer_id === trainerFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r =>
        r.member_name.toLowerCase().includes(q) ||
        r.member_code.toLowerCase().includes(q) ||
        r.trainer_name.toLowerCase().includes(q) ||
        r.package_name.toLowerCase().includes(q),
      );
    }
    return out;
  }, [rows, search, trainerFilter]);

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
      `pt-attendance-${format(new Date(), 'yyyy-MM-dd')}.csv`,
    );
  };

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">Recent attendance history</span>
          <span className="text-xs text-slate-500">(audit & export)</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && (
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-slate-600">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Member, trainer or package…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Range</label>
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Trainer</label>
              <Select value={trainerFilter} onValueChange={setTrainerFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All trainers</SelectItem>
                  {trainerOptions.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
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
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No PT sessions in this range.
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
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
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function PtAttendanceTabContent() {
  const { selectedBranch } = useBranchContext();
  const { roles, user } = useAuth();
  const isTrainerOnly = roles.length > 0 && roles.every((r: any) => r.role === 'trainer');
  const canMark = roles.some((r: any) => ['owner', 'admin', 'manager', 'trainer'].includes(r.role));

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(null);

  // Trainers
  const { data: trainers = [], isLoading: trainersLoading } = useQuery({
    queryKey: ['pt-roster-trainers', selectedBranch],
    queryFn: async (): Promise<Trainer[]> => {
      let q = supabase
        .from('trainers')
        .select('id, user_id, branch_id, is_active')
        .eq('is_active', true);
      if (selectedBranch && selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const userIds = rows.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);
      const pmap = new Map((profiles || []).map(p => [p.id, p]));
      return rows.map(r => {
        const p: any = pmap.get(r.user_id);
        return {
          id: r.id,
          user_id: r.user_id,
          branch_id: r.branch_id,
          full_name: p?.full_name || 'Trainer',
          avatar_url: p?.avatar_url || null,
        };
      }).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  // Auto-select trainer (first one, or self if trainer-role)
  const effectiveTrainerId = useMemo(() => {
    if (selectedTrainerId && trainers.some(t => t.id === selectedTrainerId)) {
      return selectedTrainerId;
    }
    if (isTrainerOnly && user) {
      const me = trainers.find(t => t.user_id === user.id);
      if (me) return me.id;
    }
    return trainers[0]?.id ?? null;
  }, [selectedTrainerId, trainers, isTrainerOnly, user]);

  // Clients of trainer
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['pt-roster-clients', selectedBranch, effectiveTrainerId],
    enabled: !!effectiveTrainerId,
    queryFn: async (): Promise<ClientCard[]> => {
      let q = supabase
        .from('member_pt_packages')
        .select('id, member_id, package_id, package_type, sessions_remaining, sessions_total, expiry_date, status')
        .eq('trainer_id', effectiveTrainerId!)
        .eq('status', 'active' as any);
      if (selectedBranch && selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
      const { data, error } = await q;
      if (error) throw error;
      const pkgs = data || [];
      if (pkgs.length === 0) return [];

      const memberIds = [...new Set(pkgs.map(p => p.member_id))];
      const packageIds = [...new Set(pkgs.map(p => p.package_id))];

      const [membersRes, packagesRes] = await Promise.all([
        supabase.from('members').select('id, member_code, user_id').in('id', memberIds),
        supabase.from('pt_packages').select('id, name').in('id', packageIds),
      ]);
      const members = membersRes.data || [];
      const packages = packagesRes.data || [];
      const userIds = members.map(m => m.user_id).filter(Boolean) as string[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      const memberMap = new Map(members.map(m => [m.id, m]));
      const pkgMap = new Map(packages.map(p => [p.id, p]));
      const profMap = new Map((profiles || []).map(p => [p.id, p]));

      return pkgs.map((p: any) => {
        const m: any = memberMap.get(p.member_id);
        const pkg: any = pkgMap.get(p.package_id);
        const prof: any = m?.user_id ? profMap.get(m.user_id) : null;
        return {
          pkgId: p.id,
          memberId: p.member_id,
          memberName: prof?.full_name || m?.member_code || 'Unknown',
          memberCode: m?.member_code || '',
          avatarUrl: prof?.avatar_url || null,
          packageName: pkg?.name || '—',
          packageType: (p.package_type || 'session_based') as 'session_based' | 'monthly',
          sessionsRemaining: p.sessions_remaining ?? 0,
          sessionsTotal: p.sessions_total ?? 0,
          expiryDate: p.expiry_date || null,
        };
      }).sort((a, b) => a.memberName.localeCompare(b.memberName));
    },
  });

  // Sessions for selected day + trainer
  const dayISO = useMemo(() => format(selectedDate, 'yyyy-MM-dd'), [selectedDate]);
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['pt-roster-sessions', effectiveTrainerId, dayISO],
    enabled: !!effectiveTrainerId,
    queryFn: async (): Promise<SessionRow[]> => {
      const from = startOfDay(selectedDate).toISOString();
      const to = endOfDay(selectedDate).toISOString();
      const { data, error } = await supabase
        .from('pt_sessions')
        .select('id, status, scheduled_at, member_pt_package_id')
        .eq('trainer_id', effectiveTrainerId!)
        .gte('scheduled_at', from)
        .lte('scheduled_at', to)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Realtime
  useRealtimeInvalidate({
    channel: 'pt-roster',
    tables: ['pt_sessions'],
    invalidateKeys: [
      ['pt-roster-sessions'],
      ['pt-roster-clients'],
      ['pt-attendance-history'],
    ],
  });

  // Map session per package (latest non-scheduled wins, fallback first)
  const sessionByPkg = useMemo(() => {
    const m = new Map<string, SessionRow>();
    sessions.forEach((s) => {
      const existing = m.get(s.member_pt_package_id);
      if (!existing) { m.set(s.member_pt_package_id, s); return; }
      // prefer logged status over scheduled
      if (existing.status === 'scheduled' && s.status !== 'scheduled') {
        m.set(s.member_pt_package_id, s);
      }
    });
    return m;
  }, [sessions]);

  const selectedTrainer = trainers.find(t => t.id === effectiveTrainerId);
  const invalidateKeys: any[][] = [
    ['pt-roster-sessions'],
    ['pt-roster-clients'],
    ['pt-attendance-history'],
    ['trainer-pt-clients'],
    ['client-session-stats'],
    ['member-pt-packages'],
  ];

  return (
    <div className="space-y-4">
      {/* Top: Week strip */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardContent className="p-4">
          <WeekStrip selected={selectedDate} onSelect={setSelectedDate} />
        </CardContent>
      </Card>

      {/* Main: Trainer rail + roster grid */}
      <div className={cn(
        'grid gap-4',
        isTrainerOnly ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[260px_1fr]',
      )}>
        {!isTrainerOnly && (
          <Card className="rounded-2xl shadow-lg shadow-slate-200/50 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Trainers
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <TrainerRail
                trainers={trainers}
                selectedId={effectiveTrainerId}
                onSelect={setSelectedTrainerId}
                isLoading={trainersLoading}
              />
            </CardContent>
          </Card>
        )}

        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base text-slate-900">
                {selectedTrainer ? `${selectedTrainer.full_name}'s clients` : 'PT roster'}
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {format(selectedDate, 'EEEE, d MMMM yyyy')}
                {clients.length > 0 && ` · ${clients.length} active client${clients.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </CardHeader>
          <CardContent>
            {!effectiveTrainerId && !trainersLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Select a trainer to view their roster.
              </div>
            ) : clientsLoading || sessionsLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-2xl" />
                ))}
              </div>
            ) : clients.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <Users className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-700">No active PT clients</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedTrainer?.full_name ?? 'This trainer'} has no active PT packages assigned.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {clients.map((c) => (
                  <ClientRosterCard
                    key={c.pkgId}
                    client={c}
                    trainerId={effectiveTrainerId!}
                    session={sessionByPkg.get(c.pkgId)}
                    canMark={canMark}
                    selectedDate={selectedDate}
                    invalidateKeys={invalidateKeys}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <HistoryPanel trainerFilterDefault={effectiveTrainerId ?? 'all'} />
    </div>
  );
}
