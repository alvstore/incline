import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Monitor, RefreshCw, GitCompare, ShieldOff, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMipsFleet } from "./useMipsFleet";
import MIPSDeviceCard from "./MIPSDeviceCard";

interface DeviceFleetTabProps {
  branchId?: string;
  canRunFleetActions?: boolean;
}

const DeviceFleetTab = ({ branchId, canRunFleetActions = false }: DeviceFleetTabProps) => {
  const qc = useQueryClient();
  const { devices, bySerial, isLoading, isConnected, connection, refetch } = useMipsFleet(branchId);
  const [busy, setBusy] = useState<"sync" | "reconcile" | "revoke" | null>(null);
  const [registeringSN, setRegisteringSN] = useState<string | null>(null);

  const handleFleetSync = async () => {
    setBusy("sync");
    try {
      const { error } = await supabase.functions.invoke("sync-to-mips", {
        body: { sync_type: "fleet", branch_id: branchId },
      });
      if (error) throw error;
      toast.success("Fleet sync started — personnel are being pushed to the MIPS server");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fleet sync failed");
    } finally {
      setBusy(null);
    }
  };

  const handleReconcile = async () => {
    setBusy("reconcile");
    try {
      const { data, error } = await supabase.functions.invoke("mips-reconcile-devices", {
        body: { branch_id: branchId },
      });
      if (error) throw error;
      const branches = ((data as { branches?: Array<{ ok?: number; failed?: number; persons?: number }> })?.branches) || [];
      const totals = branches.reduce(
        (a, b) => ({ ok: a.ok + (b.ok || 0), failed: a.failed + (b.failed || 0), persons: a.persons + (b.persons || 0) }),
        { ok: 0, failed: 0, persons: 0 }
      );
      toast.success(
        `Reconciled ${totals.persons} persons across ${branches.length} branch(es) — ${totals.ok} ok / ${totals.failed} failed`
      );
      qc.invalidateQueries({ queryKey: ["mips-devices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reconcile failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRevokeExpired = async () => {
    setBusy("revoke");
    try {
      const { data, error } = await supabase.functions.invoke("mips-access", {
        body: { action: "sweep_expired" },
      });
      if (error) throw error;
      const result = data as { revoked_count?: number };
      if (result?.revoked_count) toast.success(`Revoked hardware access for ${result.revoked_count} member(s)`);
      else toast.info("All hardware access is up to date — nothing to revoke");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke sweep failed");
    } finally {
      setBusy(null);
    }
  };

  const registerDevice = async (serial: string, name: string, ip: string | undefined, mipsId: string, online: boolean) => {
    if (!branchId) {
      toast.error("Select a branch first to register this device");
      return;
    }
    setRegisteringSN(serial);
    try {
      const { error } = await supabase.from("access_devices").insert({
        branch_id: branchId,
        serial_number: serial,
        device_name: name,
        ip_address: ip || "0.0.0.0",
        mips_device_id: mipsId,
        is_online: online,
        door_role: "both",
      });
      if (error) throw error;
      toast.success(`${name} registered in the CRM`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to register device");
    } finally {
      setRegisteringSN(null);
    }
  };

  return (
    <div className="space-y-4">
      {canRunFleetActions && (
        <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <span className="mr-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fleet actions
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={handleFleetSync}
              disabled={busy !== null}
            >
              <UploadCloud className={`mr-1.5 h-3.5 w-3.5 ${busy === "sync" ? "animate-pulse" : ""}`} />
              {busy === "sync" ? "Syncing…" : "Fleet sync"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={handleReconcile}
              disabled={busy !== null}
            >
              <GitCompare className={`mr-1.5 h-3.5 w-3.5 ${busy === "reconcile" ? "animate-pulse" : ""}`} />
              {busy === "reconcile" ? "Reconciling…" : "Reconcile devices"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[36px] rounded-xl"
              onClick={handleRevokeExpired}
              disabled={busy !== null}
            >
              <ShieldOff className={`mr-1.5 h-3.5 w-3.5 ${busy === "revoke" ? "animate-pulse" : ""}`} />
              {busy === "revoke" ? "Sweeping…" : "Revoke expired"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : devices.length === 0 ? (
        <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <div className="rounded-full bg-muted p-4">
              <Monitor className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">No terminals reported by the MIPS server</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {isConnected
                ? "The server is reachable but has no devices connected. Power on the gates and check their network."
                : connection?.message || "The MIPS server is unreachable. Verify credentials in integration settings."}
            </p>
            <Button variant="outline" size="sm" className="mt-2 min-h-[36px] rounded-xl" onClick={refetch}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((device) => {
            const local = bySerial.get((device.deviceKey || "").toUpperCase());
            return (
              <MIPSDeviceCard
                key={device.id || device.deviceKey}
                device={device}
                branchId={branchId}
                branchName={local?.branchName}
                publicIp={local?.publicIp || undefined}
                localDeviceId={local?.id}
                doorRole={local?.doorRole}
                registering={registeringSN === device.deviceKey}
                onRegister={
                  branchId && !local
                    ? () =>
                        registerDevice(
                          device.deviceKey,
                          device.name || device.deviceKey,
                          device.ip,
                          String(device.id),
                          device.onlineFlag === 1 || device.status === 1
                        )
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DeviceFleetTab;
