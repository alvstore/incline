import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import type { AppPlatform } from '@/lib/appUsage/platform';

export type DeviceInfo = { user_id: string; platform: AppPlatform; app_version: string | null; os_version: string | null; last_seen_at: string; push_enabled: boolean };

/** Shown when the per-branch (or global) `app_usage_insights` setting is on. */
export function useAppUsageEnabled() {
  const { selectedBranch } = useBranchContext() as any;
  const branchId = selectedBranch && selectedBranch !== 'all' ? selectedBranch : null;
  const { data } = useQuery({
    queryKey: ['app-usage-flag', branchId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('settings').select('branch_id,value').eq('key', 'app_usage_insights');
      const rows = data ?? [];
      const own = branchId ? rows.find((r) => r.branch_id === branchId) : undefined;
      const glob = rows.find((r) => r.branch_id === null);
      const v = (own ?? glob)?.value as any;
      return v === true || v?.enabled === true;
    },
  });
  return data === true;
}

/** Latest device per user, refreshed live and every 60s as backup (paused while tab hidden). */
export function useAppDevices(userIds: string[], enabled = true) {
  const qc = useQueryClient();
  const ids = useMemo(() => Array.from(new Set(userIds.filter(Boolean))).sort(), [userIds]);
  const key = ['app-devices', ids.join(',')];
  const q = useQuery({
    queryKey: key,
    enabled: enabled && ids.length > 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const map = new Map<string, DeviceInfo[]>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from('app_devices')
          .select('user_id,platform,app_version,os_version,last_seen_at,push_enabled')
          .in('user_id', ids.slice(i, i + 200)).order('last_seen_at', { ascending: false });
        if (error) throw error;
        for (const d of (data ?? []) as DeviceInfo[]) map.set(d.user_id, [...(map.get(d.user_id) ?? []), d]);
      }
      return map;
    },
  });
  useEffect(() => {
    if (!enabled || ids.length === 0) return;
    const ch = supabase.channel(`app-devices-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_devices' }, () => qc.invalidateQueries({ queryKey: ['app-devices'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, ids.length, qc]);
  return q.data ?? new Map<string, DeviceInfo[]>();
}
