import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Wifi, ScanFace, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { testMIPSConnection, fetchMIPSDevices, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";

interface DeviceHealthStripProps {
  branchId?: string;
}

interface TileProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "hero" | "default";
  toneClass?: string;
}

const Tile = ({ icon, label, value, hint, tone = "default", toneClass }: TileProps) => (
  <Card
    className={
      tone === "hero"
        ? "rounded-2xl border-none bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:shadow-xl"
        : "rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10"
    }
  >
    <CardContent className="p-4">
      <div className="flex items-start gap-3">
        <div
          className={
            tone === "hero"
              ? "rounded-full bg-white/15 p-2.5 backdrop-blur-sm"
              : `rounded-full p-2.5 ${toneClass ?? "bg-primary/10 text-primary"}`
          }
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p
            className={`text-[11px] font-semibold uppercase tracking-wider ${
              tone === "hero" ? "text-white/70" : "text-muted-foreground"
            }`}
          >
            {label}
          </p>
          <div className="mt-0.5 truncate text-2xl font-bold leading-tight">{value}</div>
          {hint && (
            <p className={`mt-0.5 truncate text-[11px] ${tone === "hero" ? "text-white/70" : "text-muted-foreground"}`}>
              {hint}
            </p>
          )}
        </div>
      </div>
    </CardContent>
  </Card>
);

const DeviceHealthStrip = ({ branchId }: DeviceHealthStripProps) => {
  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: ["mips-connection-test", branchId || "all"],
    queryFn: () => testMIPSConnection(branchId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const { data: devices = [] as MIPSDevice[], isLoading: devLoading } = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    enabled: !!connection?.success,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const { data: lastEvent, isLoading: feedLoading } = useQuery({
    queryKey: ["access-logs-last", branchId || "all"],
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

  const isLoading = connLoading || (connection?.success && devLoading && devices.length === 0);

  const total = devices.length;
  const online = devices.filter((d) => d.onlineFlag === 1 || d.status === 1).length;
  const faceCounts = devices.map((d) => d.faceCount || 0);
  const maxFaces = faceCounts.length ? Math.max(...faceCounts) : 0;
  const minFaces = faceCounts.length ? Math.min(...faceCounts) : 0;
  const faceGap = total > 1 ? maxFaces - minFaces : 0;

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        tone="hero"
        icon={<Server className="h-5 w-5" />}
        label="MIPS Server"
        value={connection?.success ? "Connected" : "Disconnected"}
        hint={connection?.success ? "Auto-checked every 15s" : connection?.message || "Check server credentials"}
      />
      <Tile
        icon={<Wifi className="h-5 w-5" />}
        label="Devices Online"
        value={
          <>
            {online}
            <span className="text-sm font-normal text-muted-foreground">/{total}</span>
          </>
        }
        hint={total === 0 ? "No devices reported" : online === total ? "All terminals reachable" : `${total - online} offline`}
        toneClass={online > 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}
      />
      <Tile
        icon={<ScanFace className="h-5 w-5" />}
        label="Faces On Device"
        value={maxFaces}
        hint={total > 1 ? (faceGap > 0 ? `${faceGap} behind on slowest gate` : "All gates in parity") : "Single terminal"}
        toneClass={faceGap > 0 ? "bg-amber-50 text-amber-600" : "bg-indigo-50 text-indigo-600"}
      />
      <Tile
        icon={<Activity className="h-5 w-5" />}
        label="Last Access Event"
        value={
          feedLoading ? (
            "—"
          ) : lastEvent?.created_at ? (
            <span className="text-lg">{formatDistanceToNow(new Date(lastEvent.created_at), { addSuffix: true })}</span>
          ) : (
            <span className="text-lg">No events</span>
          )
        }
        hint={lastEvent?.result ? `Result: ${lastEvent.result}` : "Waiting for webhook traffic"}
        toneClass="bg-violet-50 text-violet-600"
      />
    </div>
  );
};

export default DeviceHealthStrip;
