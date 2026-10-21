import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GEOFENCE_CACHE_KEY } from "./geofenceSetting";

const KEY = ["registration-geofence"] as const;
const DETAIL_KEY = ["registration-geofence-detail"] as const;

function cached(): boolean {
  try { return localStorage.getItem(GEOFENCE_CACHE_KEY) !== "off"; } catch { return true; }
}

/** Public: true = location check on. Fails closed (on) unless we have a last-known value. */
export function useGeofenceEnabled() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_registration_geofence");
      if (error) return cached();
      const on = data !== false;
      try { localStorage.setItem(GEOFENCE_CACHE_KEY, on ? "on" : "off"); } catch { /* ignore */ }
      return on;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export interface GeofenceDetail {
  enabled?: boolean;
  effective?: boolean;
  disabled_until?: string | null;
  updated_at?: string;
  updated_by_name?: string | null;
}

export function useGeofenceDetail(enabled = true) {
  return useQuery({
    queryKey: DETAIL_KEY,
    enabled,
    queryFn: async (): Promise<GeofenceDetail> => {
      const { data, error } = await supabase.rpc("get_registration_geofence_detail");
      if (error) throw error;
      return (data ?? {}) as GeofenceDetail;
    },
  });
}

export function useSetGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { enabled: boolean; disabledUntil: string | null }) => {
      const { error } = await supabase.rpc("set_registration_geofence", {
        p_enabled: v.enabled,
        p_disabled_until: v.disabledUntil ?? undefined,
      });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<boolean>(KEY);
      qc.setQueryData(KEY, v.enabled);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx) qc.setQueryData(KEY, ctx.prev); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: DETAIL_KEY });
    },
  });
}
