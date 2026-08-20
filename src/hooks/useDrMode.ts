import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDrHost } from "@/lib/runtime/host";
import { toast } from "sonner";

interface DrModeRow {
  enabled: boolean;
  reason: string | null;
  set_at: string | null;
  set_by: string | null;
}

async function fetchDrMode(): Promise<DrModeRow> {
  // Anonymous visitors can't evaluate the settings RLS policy (it calls
  // has_any_role, which is not executable by anon) — that produced a 401 on
  // every public page load. Signed-out sessions skip the table read entirely;
  // the host flag still covers the DR environment.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { enabled: false, reason: null, set_at: null, set_by: null };
  }


  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .is("branch_id", null)
    .eq("key", "dr_mode")
    .maybeSingle();
  if (error) throw error;
  const v = (data?.value ?? {}) as Partial<DrModeRow>;
  return {
    enabled: Boolean(v.enabled),
    reason: v.reason ?? null,
    set_at: v.set_at ?? null,
    set_by: v.set_by ?? null,
  };
}


async function fetchDrOperational(): Promise<boolean> {
  const { data, error } = await supabase.rpc("dr_is_operational");
  if (error) return false;
  return Boolean(data);
}

/**
 * Read DR mode flag from public.settings.
 * Combines the database flag (server enforces it via dr_block_writes trigger)
 * with the build-time host flag (VITE_APP_ENV=dr).
 *
 * Also exposes `isOperational` from the dr_readiness_checklist — the system
 * is only DR-ready when every step has been signed off.
 */
export function useDrMode() {
  const { data, isLoading } = useQuery({
    queryKey: ["dr-mode"],
    queryFn: fetchDrMode,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: operational } = useQuery({
    queryKey: ["dr-operational"],
    queryFn: fetchDrOperational,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const dbReadOnly = data?.enabled ?? false;
  const hostIsDr = isDrHost();
  const isReadOnly = dbReadOnly || hostIsDr;

  function assertWritable(actionLabel = "save changes"): boolean {
    if (!isReadOnly) return true;
    toast.error(
      hostIsDr
        ? `You're on the disaster-recovery environment. Cannot ${actionLabel} here.`
        : `Disaster-recovery mode is active. Cannot ${actionLabel} right now.`,
    );
    return false;
  }

  return {
    isLoading,
    isReadOnly,
    dbReadOnly,
    hostIsDr,
    isOperational: Boolean(operational),
    reason: data?.reason ?? null,
    setAt: data?.set_at ?? null,
    assertWritable,
  };
}
