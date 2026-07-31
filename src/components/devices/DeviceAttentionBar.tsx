import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ScanFace, WifiOff, Download } from "lucide-react";
import { toast } from "sonner";
import { fetchMIPSDevices, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";

interface DeviceAttentionBarProps {
  branchId?: string;
}

interface AlertRowProps {
  tone: "warning" | "danger";
  icon: React.ReactNode;
  message: React.ReactNode;
  action?: React.ReactNode;
}

const AlertRow = ({ tone, icon, message, action }: AlertRowProps) => (
  <div
    className={`flex flex-col gap-3 rounded-2xl p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
      tone === "danger" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"
    }`}
  >
    <div className="flex items-start gap-3">
      <div
        className={`rounded-full p-1.5 ${
          tone === "danger" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
        }`}
      >
        {icon}
      </div>
      <p className="text-sm leading-relaxed">{message}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

const DeviceAttentionBar = ({ branchId }: DeviceAttentionBarProps) => {
  const qc = useQueryClient();
  const [resyncing, setResyncing] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data: devices = [] as MIPSDevice[] } = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    staleTime: 10_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const { data: localDevices = [] } = useQuery({
    queryKey: ["access-devices-sns", branchId],
    queryFn: async () => {
      let query = supabase.from("access_devices").select("id, serial_number, branch_id, public_ip, door_role");
      if (branchId) query = query.eq("branch_id", branchId);
      const { data } = await query;
      return data || [];
    },
  });

  const knownSns = new Set(
    (localDevices as Array<{ serial_number: string | null }>)
      .map((d) => (d.serial_number || "").toUpperCase())
      .filter(Boolean)
  );

  const offline = devices.filter((d) => !(d.onlineFlag === 1 || d.status === 1));
  const unmapped = devices.filter((d) => !knownSns.has((d.deviceKey || "").toUpperCase()));
  const faceCounts = devices.map((d) => d.faceCount || 0);
  const maxFaces = faceCounts.length ? Math.max(...faceCounts) : 0;
  const laggingDevices = devices.length > 1 ? devices.filter((d) => (d.faceCount || 0) < maxFaces) : [];

  const handleResync = async () => {
    setResyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-face-parity", {
        body: { action: "resync", branch_id: branchId, device_ids: laggingDevices.map((d) => d.id) },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      const d = data as { dispatched?: number; total_with_photo?: number; failed?: number };
      toast.success(`Pushed ${d.dispatched ?? 0}/${d.total_with_photo ?? 0} faces to lagging gate(s)`, {
        description: d.failed ? `${d.failed} failed` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["mips-devices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Face re-sync failed");
    } finally {
      setResyncing(false);
    }
  };

  const handleImport = async () => {
    if (!branchId) {
      toast.error("Select a branch first");
      return;
    }
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-import-devices", {
        body: { branch_id: branchId },
      });
      if (error) throw error;
      const d = data as { imported?: number; updated?: number };
      toast.success(`Imported ${d?.imported ?? 0} device(s), ${d?.updated ?? 0} updated`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (devices.length === 0) return null;
  if (offline.length === 0 && laggingDevices.length === 0 && unmapped.length === 0) return null;

  return (
    <div className="space-y-3">
      {offline.length > 0 && (
        <AlertRow
          tone="danger"
          icon={<WifiOff className="h-4 w-4" />}
          message={
            <>
              <strong>{offline.length} terminal(s) offline</strong> — {offline.map((d) => d.name || d.deviceKey).join(", ")}.
              Access events and syncs will queue until they reconnect.
            </>
          }
        />
      )}

      {laggingDevices.length > 0 && (
        <AlertRow
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          message={
            <>
              Face parity gap:{" "}
              {laggingDevices
                .map((d) => `${d.name || d.deviceKey} is ${maxFaces - (d.faceCount || 0)} behind`)
                .join(" · ")}
              .
            </>
          }
          action={
            <Button size="sm" onClick={handleResync} disabled={resyncing} className="rounded-xl">
              <ScanFace className={`mr-1.5 h-3.5 w-3.5 ${resyncing ? "animate-pulse" : ""}`} />
              {resyncing ? "Pushing faces…" : "Re-sync faces"}
            </Button>
          }
        />
      )}

      {unmapped.length > 0 && (
        <AlertRow
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          message={
            <>
              <strong>{unmapped.length} device(s)</strong> on the MIPS server aren't registered in the CRM yet.
            </>
          }
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={handleImport}
              disabled={importing || !branchId}
              className="rounded-xl"
            >
              <Download className={`mr-1.5 h-3.5 w-3.5 ${importing ? "animate-pulse" : ""}`} />
              {importing ? "Importing…" : "Import all"}
            </Button>
          }
        />
      )}
    </div>
  );
};

export default DeviceAttentionBar;
