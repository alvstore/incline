import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  testMIPSConnection,
  fetchMIPSDevices,
  fetchAllMIPSPersons,
  mipsPersonHasPhoto,
  normalizeMIPSPersonSn,
  type MIPSDevice,
  type MIPSPerson,
} from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";

export interface LocalAccessDevice {
  id: string;
  serial_number: string | null;
  branch_id: string | null;
  public_ip: string | null;
  door_role: "entry" | "exit" | "both" | null;
}

export interface FaceLedgerRow {
  mips_device_id: number;
  device_name: string | null;
  person_sn: string;
  person_name: string | null;
  person_type: string;
  state: string;
  reason: string | null;
  attempts: number;
  last_attempt_at: string | null;
}

export interface GateTruth {
  deviceId: number;
  name: string;
  online: boolean;
  /** Photos the gate itself reports holding. */
  faces: number | null;
  /** People the gate itself reports holding. */
  persons: number | null;
  /** Photos the MIPS server holds — the target every gate must reach. */
  target: number;
  /** target - faces (never negative), or null when we cannot compare. */
  behind: number | null;
  pct: number | null;
  /** Ledger rows for this gate. */
  rows: FaceLedgerRow[];
  /** Names we can prove reached this gate, never more than the gate's own count. */
  verified: number;
  unverified: number;
  awaiting: FaceLedgerRow[];
  rejected: FaceLedgerRow[];
  /**
   * The gap, broken into buckets that always add back up to `behind`:
   * people queued for a push, people whose photo the gate refused, and the
   * remainder we cannot yet attribute to a named person.
   */
  gapWaiting: number;
  gapRejected: number;
  gapUnaccounted: number;
  /** People a re-sync can actually help right now. */
  gapActionable: number;
}

/**
 * Single source of truth for the Device Command Center.
 *
 * Every surface (health strip, attention bar, fleet tab, personnel sync tab and
 * the per-gate face panel) renders from this one hook, so the gate numbers can
 * never disagree between tabs. There is exactly one definition of "behind":
 * the MIPS server's face-photo count minus the gate's own face counter.
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

  /**
   * What the MIPS server itself holds. The local `mips_sync_status` column only
   * records what we attempted, so the person list on the server is the only
   * reliable baseline for "how many photos should every gate carry".
   */
  const serverTruthQuery = useQuery({
    queryKey: ["mips-server-truth", scope],
    queryFn: async () => {
      const rows = await fetchAllMIPSPersons(200, branchId);
      const map: Record<string, { exists: boolean; hasFace: boolean }> = {};
      for (const r of rows) {
        if (!r?.personSn) continue;
        map[normalizeMIPSPersonSn(r.personSn)] = {
          exists: true,
          hasFace: mipsPersonHasPhoto(r as MIPSPerson & Record<string, unknown>),
        };
      }
      return {
        map,
        total: rows.length,
        withFace: rows.filter((r) => mipsPersonHasPhoto(r as MIPSPerson & Record<string, unknown>)).length,
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const ledgerQuery = useQuery({
    queryKey: ["mips-face-ledger", scope],
    queryFn: async (): Promise<FaceLedgerRow[]> => {
      let q = supabase
        .from("mips_device_face_state")
        .select(
          "mips_device_id, device_name, person_sn, person_name, person_type, state, reason, attempts, last_attempt_at",
        )
        .order("state", { ascending: true })
        .limit(2000);
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as FaceLedgerRow[];
    },
    refetchInterval: 60_000,
  });

  const devices = devicesQuery.data ?? [];
  const local = localQuery.data ?? [];
  const ledger = ledgerQuery.data ?? [];

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
  const maxFaces = faceCounts.length ? Math.max(...faceCounts) : 0;
  const maxPersons = devices.reduce((m, d) => Math.max(m, d.personCount || 0), 0);

  // THE definition of "behind" — one baseline everywhere: the server's photos.
  const serverWithFace = serverTruthQuery.data?.withFace ?? 0;
  const serverTotal = serverTruthQuery.data?.total ?? 0;
  const target = serverWithFace > 0 ? serverWithFace : maxFaces;

  const ledgerDeviceIds = [...new Set(ledger.map((r) => r.mips_device_id))];
  const gateIds = [...new Set([...devices.map((d) => d.id), ...ledgerDeviceIds])];

  const gates: GateTruth[] = gateIds.map((deviceId) => {
    const live = devices.find((d) => d.id === deviceId);
    const rows = ledger.filter((r) => r.mips_device_id === deviceId);
    const faces = live?.faceCount ?? null;
    const persons = live?.personCount ?? null;
    const behind = faces !== null && target > 0 ? Math.max(target - faces, 0) : null;
    const enrolled = rows.filter((r) => r.state === "enrolled").length;
    // The ledger can only ever prove as many names as the gate actually holds;
    // anything above the gate's own counter is stale bookkeeping, not truth.
    const verified = faces !== null ? Math.min(enrolled, faces) : enrolled;
    const counted = faces !== null ? Math.max(faces - verified, 0) : 0;
    const awaiting = rows.filter((r) => r.state === "pending" || r.state === "missing");
    const rejected = rows.filter((r) => r.state === "rejected");

    // Only report people we can actually name from the sync ledger. The raw
    // counter delta includes archived/legacy server records the gates never
    // need, so inventing an "unaccounted" bucket produced fake numbers.
    const gapWaiting = awaiting.length;
    const gapRejected = rejected.length;
    const gapUnaccounted = 0;

    return {
      deviceId,
      name: live?.deviceName || rows[0]?.device_name || `Device ${deviceId}`,
      online: live ? live.onlineFlag === 1 || live.status === 1 : false,
      faces,
      persons,
      target,
      behind,
      pct: faces !== null && target > 0 ? Math.min(Math.round((faces / target) * 100), 100) : null,
      rows,
      verified,
      unverified: counted,
      awaiting,
      rejected,
      gapWaiting,
      gapRejected,
      gapUnaccounted,
      gapActionable: gapWaiting,
    };
  });

  // A gate is only "lagging" when the ledger names someone it is still missing.
  const laggingGates = gates.filter((g) => g.gapWaiting + g.gapRejected > 0);
  const worstBehind = laggingGates.reduce((m, g) => Math.max(m, g.behind ?? 0), 0);
  const laggingDevices = devices.filter((d) =>
    laggingGates.some((g) => g.deviceId === d.id),
  );
  /** Gates a re-sync can actually move forward right now. */
  const actionableGates = laggingGates.filter((g) => g.gapActionable > 0);
  const actionableDevices = devices.filter((d) => actionableGates.some((g) => g.deviceId === d.id));
  const retakeNeeded = new Set(
    laggingGates.flatMap((g) => g.rejected.map((r) => r.person_sn)),
  ).size;

  // A connection reading older than two minutes is stale, not "connected".
  const connectionCheckedAt = connectionQuery.dataUpdatedAt || 0;
  const connectionStale = connectionCheckedAt > 0 && Date.now() - connectionCheckedAt > 120_000;

  return {
    connection: connectionQuery.data,
    isConnected: Boolean(connectionQuery.data?.success),
    connectionCheckedAt: connectionCheckedAt ? new Date(connectionCheckedAt) : null,
    connectionStale,
    connectionChecking: connectionQuery.isFetching,
    actionableGates,
    actionableDevices,
    retakeNeeded,
    devices,
    bySerial,
    online,
    offline,
    unmapped,
    gates,
    laggingGates,
    laggingDevices,
    worstBehind,
    maxFaces,
    faceGap: worstBehind,
    maxPersons,
    serverTruth: serverTruthQuery.data,
    serverWithFace,
    serverTotal,
    target,
    serverTruthLoading: serverTruthQuery.isFetching,
    serverTruthError: serverTruthQuery.isError ? serverTruthQuery.error : null,
    refetchServerTruth: serverTruthQuery.refetch,
    ledger,
    ledgerLoading: ledgerQuery.isLoading,
    ledgerError: ledgerQuery.isError ? ledgerQuery.error : null,
    lastEvent: lastEventQuery.data,
    isLoading:
      connectionQuery.isLoading || (devicesQuery.isLoading && devices.length === 0),
    refetch: () => {
      connectionQuery.refetch();
      devicesQuery.refetch();
      localQuery.refetch();
      serverTruthQuery.refetch();
      ledgerQuery.refetch();
    },
  };
}
