import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { testMIPSConnection, fetchMIPSDevices, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";

export interface LocalAccessDevice {
  id: string;
  serial_number: string | null;
  branch_id: string | null;
  public_ip: string | null;
  door_role: "entry" | "exit" | "both" | null;
}

/**
 * Single source of truth for the Device Command Center.
 *
 * The health strip, attention bar and fleet tab all render from this one hook so
 * the fleet numbers can never disagree with each other and the shared queries are
 * de-duplicated by TanStack Query (no flicker between tabs).
 */
export function useMipsFleet(branchId?: string) {
  const scope = branchId || "all";

  const connectionQuery = useQuery({
    queryKey: ["mips-connection-test", scope],
    queryFn: () => testMIPSConnection(branchId),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const devicesQuery = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", scope],
    queryFn: () => fetchMIPSDevices(branchId),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const localQuery = useQuery<LocalAccessDevice[]>({
    queryKey: ["access-devices-sns", branchId],
    queryFn: async () => {
      let query = supabase
        .from("access_devices")
        .select("id, serial_number, branch_id, public_ip, door_role");
      if (branchId) query = query.eq("branch_id", branchId);
      const { data } = await query;
      return (data || []) as LocalAccessDevice[];
    },
    staleTime: 30_000,
  });

  const branchesQuery = useQuery({
    queryKey: ["branches-list-names"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name");
      return data || [];
    },
    staleTime: 300_000,
  });

  const lastEventQuery = useQuery({
    queryKey: ["access-logs-last", scope],
    queryFn: async () => {
      let q = supabase
        .from("access_logs")
        .select("created_at, result")
        .order("created_at", { ascending: false })
        .limit(1);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data } = await q;
      return (data && data[0]) || null;
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const devices = devicesQuery.data ?? [];
  const local = localQuery.data ?? [];

  const branchNameById = new Map((branchesQuery.data ?? []).map((b) => [b.id, b.name as string]));

  const bySerial = new Map<
    string,
    { id: string; doorRole: "entry" | "exit" | "both"; publicIp: string | null; branchName?: string }
  >();
  for (const d of local) {
    if (!d.serial_number) continue;
    bySerial.set(d.serial_number.toUpperCase(), {
      id: d.id,
      doorRole: (d.door_role || "both") as "entry" | "exit" | "both",
      publicIp: d.public_ip,
      branchName: d.branch_id ? branchNameById.get(d.branch_id) : undefined,
    });
  }

  const online = devices.filter((d) => d.onlineFlag === 1 || d.status === 1);
  const offline = devices.filter((d) => !(d.onlineFlag === 1 || d.status === 1));
  const unmapped = devices.filter((d) => !bySerial.has((d.deviceKey || "").toUpperCase()));

  const faceCounts = devices.map((d) => d.faceCount || 0);
  // A person exists once on the MIPS server no matter how many terminals mirror it —
  // MAX is the unique enrolment count, the spread is the parity gap.
  const maxFaces = faceCounts.length ? Math.max(...faceCounts) : 0;
  const minFaces = faceCounts.length ? Math.min(...faceCounts) : 0;
  const faceGap = devices.length > 1 ? maxFaces - minFaces : 0;
  const laggingDevices = devices.length > 1 ? devices.filter((d) => (d.faceCount || 0) < maxFaces) : [];
  const maxPersons = devices.reduce((m, d) => Math.max(m, d.personCount || 0), 0);

  return {
    connection: connectionQuery.data,
    isConnected: Boolean(connectionQuery.data?.success),
    devices,
    bySerial,
    online,
    offline,
    unmapped,
    laggingDevices,
    maxFaces,
    faceGap,
    maxPersons,
    lastEvent: lastEventQuery.data,
    isLoading:
      connectionQuery.isLoading || (devicesQuery.isLoading && devices.length === 0),
    refetch: () => {
      connectionQuery.refetch();
      devicesQuery.refetch();
      localQuery.refetch();
    },
  };
}
