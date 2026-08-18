/**
 * MemberAttendanceHistory — targeted search-first history view for a branch.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { getISTToday } from '@/lib/utils/datetime';
import { History, AlertTriangle, CalendarDays, ArrowLeft, Download, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { MemberHistorySearch } from './MemberHistorySearch';
import { exportToCSV } from '@/lib/csvExport';

type Visit = {
  id: string;
  member_id: string;
  check_in: string;
  check_out: string | null;
  check_in_method: string | null;
  branch_id: string;
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
  const [month, setMonth] = useState(getISTToday().substring(0, 7));
  const [selectedMember, setSelectedMember] = useState<any>(null);

  const { data: visits = [], isLoading, isError } = useQuery({
    queryKey: ['member-attendance-history', branchId, month, selectedMember?.id],
    enabled: !!branchId && !!selectedMember?.id,
    queryFn: async (): Promise<Visit[]> => {
      const [year, m] = month.split('-').map(Number);
      const start = `${month}-01T00:00:00`;
      const end = new Date(year, m, 0, 23, 59, 59, 999).toISOString();

      const { data, error } = await supabase
          .from('member_attendance')
          .select('id, member_id, check_in, check_out, check_in_method, branch_id')
          .eq('branch_id', branchId!)
          .eq('member_id', selectedMember.id)
          .gte('check_in', start)
          .lte('check_in', end)
          .order('check_in', { ascending: false });
      
      if (error) throw error;
      return (data || []) as Visit[];
    },
  });

  const summary = useMemo(() => {
    if (!visits.length) return null;
    let totalMinutes = 0;
    let checkedOutCount = 0;
    let lastVisit = visits[0].check_in;

    for (const v of visits) {
      if (v.check_out) {
        const mins = (new Date(v.check_out).getTime() - new Date(v.check_in).getTime()) / 60000;
        if (mins > 0 && mins < 16 * 60) {
          totalMinutes += mins;
          checkedOutCount += 1;
        }
      }
      if (new Date(v.check_in) > new Date(lastVisit)) lastVisit = v.check_in;
    }

    return {
      totalVisits: visits.length,
      avgDuration: checkedOutCount > 0 ? Math.round(totalMinutes / checkedOutCount) : 0,
      lastVisit
    };
  }, [visits]);

  const handleExport = () => {
    if (!visits.length || !selectedMember) return;
    const dataToExport = visits.map(v => ({
      Member: selectedMember.full_name,
      Code: selectedMember.member_code,
      Date: format(parseISO(v.check_in), 'yyyy-MM-dd'),
      'Check-in': format(parseISO(v.check_in), 'hh:mm a'),
      'Check-out': v.check_out ? format(parseISO(v.check_out), 'hh:mm a') : 'Open',
      Duration: durationLabel(v.check_in, v.check_out),
      Source: v.check_in_method || 'manual'
    }));
    exportToCSV(dataToExport, `Attendance_${selectedMember.full_name}_${month}.csv`);
  };

  return (
    <div className="space-y-6">
      {!selectedMember ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-300">
          <div className="bg-indigo-50 p-4 rounded-full mb-6">
            <History className="h-10 w-10 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Member Attendance History</h2>
          <p className="text-slate-500 max-w-sm mb-8 leading-relaxed">
            Search for a member by name, mobile, or member code to view their detailed monthly attendance records.
          </p>
          <MemberHistorySearch branchId={branchId} onSelect={setSelectedMember} />
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setSelectedMember(null)}
                className="h-10 w-10 rounded-full hover:bg-slate-100"
              >
                <ArrowLeft className="h-5 w-5 text-slate-600" />
              </Button>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 ring-2 ring-indigo-50">
                  <AvatarImage src={selectedMember.avatar_url || undefined} />
                  <AvatarFallback className="bg-indigo-600 text-white font-bold text-lg">
                    {initials(selectedMember.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-bold text-lg text-slate-900 leading-tight">{selectedMember.full_name}</h3>
                  <p className="text-sm text-slate-500 font-medium">{selectedMember.member_code}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <Input
                  id="member-history-month" 
                  type="month" 
                  value={month}
                  onChange={(e) => setMonth(e.target.value)} 
                  className="h-10 w-[180px] rounded-xl border-slate-200"
                />
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleExport}
                disabled={visits.length === 0}
                className="h-10 gap-2 rounded-xl border-slate-200"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setSelectedMember(null)}
                className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl"
              >
                Change Member
              </Button>
            </div>
          </div>

          {/* Stats Summary */}
          {summary && (
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                      <CalendarDays className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Visits</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{summary.totalVisits}</p>
                  <p className="text-xs text-slate-400 mt-1">Sessions this month</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                      <History className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Avg Duration</p>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{summary.avgDuration}m</p>
                  <p className="text-xs text-slate-400 mt-1">Minutes per session</p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                      <Info className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Last Visit</p>
                  </div>
                  <p className="text-xl font-bold text-slate-900">
                    {format(parseISO(summary.lastVisit), 'd MMM, h:mm a')}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Recent check-in</p>
                </CardContent>
              </Card>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : isError ? (
            <Card className="rounded-2xl border-dashed border-2 border-slate-200 py-12 text-center text-slate-500">
              <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500 opacity-50" />
              <p className="font-medium">Could not load attendance history.</p>
            </Card>
          ) : visits.length === 0 ? (
            <Card className="rounded-2xl border-dashed border-2 border-slate-200 py-20 text-center text-slate-500">
              <History className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-lg font-medium text-slate-400">No attendance records found for this month.</p>
              <p className="text-sm text-slate-400">Try selecting a different month or member.</p>
            </Card>
          ) : (
            <Card className="rounded-2xl border-0 shadow-xl shadow-slate-200/50 overflow-hidden bg-white">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                <CardTitle className="text-lg font-bold text-slate-900">Session Logs</CardTitle>
                <CardDescription>Detailed check-in and check-out records for {format(parseISO(`${month}-01`), 'MMMM yyyy')}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50/80">
                      <TableRow>
                        <TableHead className="font-bold text-slate-900 py-4">Date</TableHead>
                        <TableHead className="font-bold text-slate-900 py-4">Check-in</TableHead>
                        <TableHead className="font-bold text-slate-900 py-4">Check-out</TableHead>
                        <TableHead className="font-bold text-slate-900 py-4 text-center">Duration</TableHead>
                        <TableHead className="font-bold text-slate-900 py-4 text-right pr-6">Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visits.map((v) => (
                        <TableRow key={v.id} className="transition-colors duration-150 hover:bg-slate-50 group">
                          <TableCell className="font-medium text-slate-700 py-4">
                            {format(parseISO(v.check_in), 'd MMM yyyy')}
                          </TableCell>
                          <TableCell className="text-slate-600 font-medium">
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100 rounded-lg px-2 py-1">
                              {format(parseISO(v.check_in), 'h:mm a')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 font-medium">
                            {v.check_out ? (
                              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-100 rounded-lg px-2 py-1">
                                {format(parseISO(v.check_out), 'h:mm a')}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 rounded-lg px-2 py-1">
                                Open
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded-full">
                              {durationLabel(v.check_in, v.check_out)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Badge variant="outline" className="rounded-full text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 border-indigo-100 text-indigo-600 bg-indigo-50/30">
                              {(v.check_in_method || 'manual').replace('_', ' ')}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
