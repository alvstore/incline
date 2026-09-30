/**
 * BlockedEntryAttempts — gate scans that were refused (dues, expiry, freeze).
 *
 * A refused scan is never an attendance record, but the club still needs to
 * know the person physically turned up. These rows come from the gate event
 * log, not from attendance.
 */
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ShieldAlert, AlertTriangle, DoorClosed } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface BlockedAttempt {
  id: string;
  captured_at: string;
  device_sn: string | null;
  message: string | null;
  result: string | null;
}

interface BlockedEntryAttemptsProps {
  /** Restrict to one member (member history view). */
  memberId?: string;
  branchId: string | undefined;
  /** Inclusive ISO start of the window. */
  from: string;
  /** Inclusive ISO end of the window. */
  to: string;
  title?: string;
  description?: string;
  /** Show the member name column (branch-wide view). */
  showMemberColumn?: boolean;
}

interface Row extends BlockedAttempt {
  member_id: string | null;
  memberName?: string | null;
  memberCode?: string | null;
}

function reasonLabel(message: string | null): { label: string; tone: string } {
  const text = (message || '').toLowerCase();
  if (text.includes('dues')) return { label: 'Payment overdue', tone: 'bg-red-100 text-red-700' };
  if (text.includes('expired')) return { label: 'Plan expired', tone: 'bg-amber-100 text-amber-700' };
  if (text.includes('frozen')) return { label: 'Plan frozen', tone: 'bg-blue-100 text-blue-700' };
  if (text.includes('already checked in')) return { label: 'Already inside', tone: 'bg-slate-100 text-slate-600' };
  if (text.includes('no membership')) return { label: 'No active plan', tone: 'bg-slate-100 text-slate-600' };
  return { label: 'Entry refused', tone: 'bg-slate-100 text-slate-600' };
}

export function BlockedEntryAttempts({
  memberId,
  branchId,
  from,
  to,
  title = 'Blocked entry attempts',
  description = 'Scans where the person came to the club but was refused entry.',
  showMemberColumn = false,
}: BlockedEntryAttemptsProps) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['blocked-entry-attempts', branchId, memberId ?? 'all', from, to],
    enabled: !!branchId,
    queryFn: async (): Promise<Row[]> => {
      let query = supabase
        .from('access_logs')
        .select('id, member_id, captured_at, device_sn, message, result')
        .eq('branch_id', branchId!)
        .in('result', ['member_denied', 'denied'])
        .gte('captured_at', from)
        .lte('captured_at', to)
        .order('captured_at', { ascending: false })
        .limit(200);

      if (memberId) query = query.eq('member_id', memberId);

      const { data, error } = await query;
      if (error) throw error;

      const base = (data || []) as Row[];
      if (!showMemberColumn || base.length === 0) return base;

      const ids = [...new Set(base.map((r) => r.member_id).filter(Boolean))] as string[];
      if (ids.length === 0) return base;

      const { data: members } = await supabase
        .from('members')
        .select('id, member_code, user_id')
        .in('id', ids);

      const userIds = (members || []).map((m) => m.user_id).filter(Boolean) as string[];
      const { data: profiles } = userIds.length
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] as Array<{ id: string; full_name: string | null }> };

      const nameByUserId = new Map((profiles || []).map((p) => [p.id, p.full_name]));
      const infoById = new Map(
        (members || []).map((m) => [
          m.id,
          { code: m.member_code, name: m.user_id ? nameByUserId.get(m.user_id) ?? null : null },
        ]),
      );

      return base.map((r) => ({
        ...r,
        memberCode: r.member_id ? infoById.get(r.member_id)?.code ?? null : null,
        memberName: r.member_id ? infoById.get(r.member_id)?.name ?? null : null,
      }));
    },
  });

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50 bg-white overflow-hidden">
      <CardHeader className="bg-red-50/40 border-b border-red-100/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-red-50 text-red-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold text-slate-900">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <div className="py-10 text-center text-slate-500">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500 opacity-60" />
            <p className="font-medium">Could not load blocked entry attempts.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <DoorClosed className="mx-auto mb-3 h-9 w-9 text-slate-300" />
            <p className="font-medium text-slate-400">No refused entries in this period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="font-bold text-slate-900 py-4">When</TableHead>
                  {showMemberColumn && <TableHead className="font-bold text-slate-900 py-4">Member</TableHead>}
                  <TableHead className="font-bold text-slate-900 py-4">Reason</TableHead>
                  <TableHead className="font-bold text-slate-900 py-4">Details</TableHead>
                  <TableHead className="font-bold text-slate-900 py-4 text-right pr-6">Gate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const reason = reasonLabel(row.message);
                  return (
                    <TableRow key={row.id} className="transition-colors duration-150 hover:bg-slate-50">
                      <TableCell className="font-medium text-slate-700 py-4 whitespace-nowrap">
                        {format(parseISO(row.captured_at), 'd MMM yyyy, h:mm a')}
                      </TableCell>
                      {showMemberColumn && (
                        <TableCell className="text-slate-700">
                          <span className="font-semibold">{row.memberName || 'Unmatched person'}</span>
                          {row.memberCode && (
                            <span className="block text-xs text-slate-500">{row.memberCode}</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${reason.tone}`}
                        >
                          {reason.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 max-w-md">
                        {row.message || '—'}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Badge
                          variant="outline"
                          className="rounded-full text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 border-slate-200 text-slate-600 bg-slate-50"
                        >
                          {row.device_sn || 'gate'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
