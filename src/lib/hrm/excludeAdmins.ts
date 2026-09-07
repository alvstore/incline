import { supabase } from '@/integrations/supabase/client';

/**
 * Owners and admins are never treated as payroll/roster staff.
 *
 * They usually have an `employees` row (for identity, gate access, contracts),
 * but must not appear in HRM directories, the staff roster or payroll runs.
 * Mirrored on the server inside `payroll_create_run`.
 */
export async function fetchPrivilegedUserIds(userIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean) as string[]));
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from('user_roles')
    .select('user_id')
    .in('user_id', ids)
    .in('role', ['owner', 'admin']);
  return new Set((data || []).map((r: { user_id: string }) => r.user_id));
}
