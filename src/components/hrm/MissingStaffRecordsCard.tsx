import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, UserPlus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';

const PRIVILEGED_ROLES = ['owner', 'admin', 'manager'] as const;

interface GapRow {
  userId: string;
  name: string;
  email: string | null;
  role: string;
}

/**
 * Owners/admins/managers without an `employees` record are invisible to HR,
 * payroll and — critically — the MIPS turnstile, which then treats them as
 * outsiders. This card surfaces the gap and fixes it in one click.
 */
export function MissingStaffRecordsCard() {
  const queryClient = useQueryClient();
  const { selectedBranch, branches } = useBranchContext();

  const { data, isLoading, isError } = useQuery<GapRow[]>({
    queryKey: ['hrm-missing-staff-records'],
    queryFn: async () => {
      const { data: roleRows, error: roleErr } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', PRIVILEGED_ROLES as unknown as string[]);
      if (roleErr) throw roleErr;

      const ids = Array.from(new Set((roleRows || []).map((r) => r.user_id)));
      if (ids.length === 0) return [];

      const [{ data: emps }, { data: profiles }] = await Promise.all([
        supabase.from('employees').select('user_id').in('user_id', ids),
        supabase.from('profiles').select('id, full_name, email').in('id', ids),
      ]);

      const covered = new Set((emps || []).map((e) => e.user_id));
      return ids
        .filter((id) => !covered.has(id))
        .map((id) => {
          const p = (profiles || []).find((x) => x.id === id);
          const role =
            (roleRows || []).find((r) => r.user_id === id)?.role || 'staff';
          return {
            userId: id,
            name: p?.full_name || p?.email || 'Unknown user',
            email: p?.email ?? null,
            role,
          };
        });
    },
  });

  const defaultBranchId = useMemo(
    () => (selectedBranch && selectedBranch !== 'all' ? selectedBranch : branches?.[0]?.id ?? null),
    [selectedBranch, branches],
  );

  const createRecord = useMutation({
    mutationFn: async (row: GapRow) => {
      if (!defaultBranchId) throw new Error('Select a branch first');
      const { error } = await supabase.from('employees').insert({
        user_id: row.userId,
        branch_id: defaultBranchId,
        position: row.role === 'owner' ? 'Owner' : row.role === 'admin' ? 'Director' : 'Manager',
        department: 'Management',
        hire_date: new Date().toISOString().slice(0, 10),
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Staff record created — biometric sync is now available');
      queryClient.invalidateQueries({ queryKey: ['hrm-missing-staff-records'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-employees'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardContent className="p-5 space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.length === 0) return null;

  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-amber-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="rounded-full bg-amber-50 p-2 text-amber-600">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          Missing staff records
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{data.length}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          These privileged users have no HR record, so payroll and the turnstile treat them as
          outsiders.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((row) => (
          <div
            key={row.userId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.name}</p>
              <p className="truncate text-xs text-slate-500">
                {row.email} · {row.role}
              </p>
            </div>
            <Button
              size="sm"
              className="cursor-pointer"
              disabled={createRecord.isPending}
              onClick={() => createRecord.mutate(row)}
            >
              {createRecord.isPending ? (
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5 animate-pulse" />
              ) : (
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              )}
              Create staff record
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
