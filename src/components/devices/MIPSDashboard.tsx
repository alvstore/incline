import { useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import MIPSConnectionCard from "./MIPSConnectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Monitor, Wifi, WifiOff, Users, Fingerprint, RefreshCw, Server, Heart, ShieldAlert, Zap,
} from "lucide-react";
import { testMIPSConnection, fetchMIPSDevices, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface MIPSDashboardProps {
  branchId?: string;
  branchName?: string;
}

const MIPSDashboard = ({ branchId, branchName }: MIPSDashboardProps) => {
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [heartbeatPulse, setHeartbeatPulse] = useState(false);
  const prevDeviceStatusRef = useRef<Map<string, number>>(new Map());

  const { data: mipsConnection, isLoading: isTestingConnection, refetch: retestConnection } = useQuery({
    queryKey: ["mips-connection-test", branchId || "all"],
    queryFn: () => testMIPSConnection(branchId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const { data: mipsDevices = [] as MIPSDevice[], dataUpdatedAt } = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    // Once we've fetched devices once, keep displaying them even if a subsequent
    // connection test blips — prevents the stat cards from flashing to zero.
    enabled: !!mipsConnection?.success,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });


  useEffect(() => {
    if (dataUpdatedAt) {
      setLastChecked(new Date(dataUpdatedAt));
      setHeartbeatPulse(true);
      const timer = setTimeout(() => setHeartbeatPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [dataUpdatedAt]);

  useEffect(() => {
    if (mipsDevices.length === 0) return;
    const currentStatusMap = new Map<string, number>();
    mipsDevices.forEach((d) => {
      currentStatusMap.set(d.deviceKey || String(d.id), d.onlineFlag ?? d.status);
    });
    const prev = prevDeviceStatusRef.current;
    if (prev.size > 0) {
      for (const [deviceId, prevStatus] of prev.entries()) {
        const currentStatus = currentStatusMap.get(deviceId);
        if (prevStatus === 1 && currentStatus !== undefined && currentStatus !== 1) {
          const deviceName = mipsDevices.find((d) => (d.deviceKey || String(d.id)) === deviceId)?.name || deviceId;
          sendOfflineNotification(deviceName);
        }
      }
    }
    prevDeviceStatusRef.current = currentStatusMap;
  }, [mipsDevices]);

  const sendOfflineNotification = async (deviceName: string) => {
    try {
      const { data: adminUsers } = await supabase
        .from("user_roles" as any)
        .select("user_id")
        .in("role", ["owner", "admin"]);
      if (adminUsers && adminUsers.length > 0) {
        const notifications = (adminUsers as any[]).map((u: any) => ({
          user_id: u.user_id,
          title: "Device Offline Alert",
          message: `Device "${deviceName}" has gone offline. Please check the hardware connection.`,
          type: "warning" as const,
          category: "device",
          is_read: false,
        }));
        await supabase.from("notifications").insert(notifications);
      }
    } catch (e) {
      console.warn("Failed to send offline notification:", e);
    }
  };

  const [checkingExpired, setCheckingExpired] = useState(false);
  const handleCheckExpiredAccess = async () => {
    setCheckingExpired(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-access", {
        body: { action: "sweep_expired" },
      });
      if (error) throw error;
      const result = data as { revoked_count?: number; errors?: string[] };
      if (result.revoked_count && result.revoked_count > 0) {
        toast.success(`Revoked hardware access for ${result.revoked_count} expired/frozen member(s)`);
      } else {
        toast.info("All hardware access is up to date — no revocations needed");
      }
      if (result.errors?.length) {
        console.warn("Expired access check errors:", result.errors);
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to check expired access");
    } finally {
      setCheckingExpired(false);
    }
  };

  const [syncingFleet, setSyncingFleet] = useState(false);
  const handleFleetSync = async () => {
    setSyncingFleet(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-to-mips", {
        body: { sync_type: "fleet", branch_id: branchId },
      });
      if (error) throw error;
      toast.success("Fleet sync initiated — personnel data being pushed to all devices");
    } catch (e: any) {
      toast.error(e.message || "Fleet sync failed");
    } finally {
      setSyncingFleet(false);
    }
  };

  const [reconciling, setReconciling] = useState(false);
  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-reconcile-devices", {
        body: { branch_id: branchId },
      });
      if (error) throw error;
      const branches = (data as any)?.branches || [];
      const totals = branches.reduce(
        (a: any, b: any) => ({ ok: a.ok + (b.ok || 0), failed: a.failed + (b.failed || 0), persons: a.persons + (b.persons || 0) }),
        { ok: 0, failed: 0, persons: 0 }
      );
      toast.success(`Reconciled ${totals.persons} persons across ${branches.length} branch(es) — ${totals.ok} ok / ${totals.failed} failed`);
    } catch (e: any) {
      toast.error(e.message || "Reconcile failed");
    } finally {
      setReconciling(false);
    }
  };


  const mipsOnline = mipsDevices.filter((d) => (d.onlineFlag === 1 || d.status === 1)).length;
  const mipsTotal = mipsDevices.length;
  // A person exists once on the MIPS server regardless of how many devices mirror it.
  // Summing per-device counts double-counts every shared enrolment across terminals —
  // use the MAX so the dashboard shows unique persons/faces, not the fleet-wide sum.
  const mipsFaces = mipsDevices.reduce((max, d) => Math.max(max, d.faceCount || 0), 0);
  const mipsPersons = mipsDevices.reduce((max, d) => Math.max(max, d.personCount || 0), 0);
  const mipsFacesTotalPerDevice = mipsDevices.reduce((sum, d) => sum + (d.faceCount || 0), 0);
  const mipsPersonsTotalPerDevice = mipsDevices.reduce((sum, d) => sum + (d.personCount || 0), 0);
  // Drift = at least one device is missing a person the leader has.
  const mipsDrift = mipsTotal > 1 && (mipsPersons * mipsTotal !== mipsPersonsTotalPerDevice);

  return (
    <div className="space-y-6">
      {/* Hero Card with glassmorphism */}
      <Card className="rounded-2xl bg-gradient-to-r from-primary to-primary text-primary-foreground shadow-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.15)_0%,_transparent_60%)]" />
        <CardContent className="p-6 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-card/10 backdrop-blur-sm border border-primary-foreground/10">
                <Server className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold">MIPS Middleware Server</h3>
                <p className="text-sm text-primary-foreground/70">Smart Pass v3 • RuoYi Cloud Integration</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={`border-primary-foreground/30 ${
                  mipsConnection?.success
                    ? "bg-success/20 text-success"
                    : "bg-destructive/20 text-destructive"
                }`}
              >
                <div className={`h-2 w-2 rounded-full mr-1.5 ${
                  mipsConnection?.success
                    ? "bg-success shadow-[0_0_6px_2px_rgba(34,197,94,0.5)] animate-pulse"
                    : "bg-destructive shadow-[0_0_6px_2px_rgba(239,68,68,0.5)]"
                }`} />
                {isTestingConnection ? "Testing..." : mipsConnection?.success ? "Connected" : "Disconnected"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground/70 hover:text-primary-foreground hover:bg-card/10"
                onClick={() => retestConnection()}
              >
                <RefreshCw className={`h-4 w-4 ${isTestingConnection ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-primary-foreground/50">
              <Heart className={`h-3 w-3 transition-transform ${heartbeatPulse ? "scale-150 text-destructive" : "scale-100"}`} />
              <span>Last checked: {formatDistanceToNow(lastChecked, { addSuffix: true })}</span>
              <span className="text-primary-foreground/30">• Auto-refresh 15s</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-card/10 gap-1.5 text-xs"
                onClick={handleFleetSync}
                disabled={syncingFleet}
              >
                <Zap className={`h-3.5 w-3.5 ${syncingFleet ? "animate-pulse" : ""}`} />
                {syncingFleet ? "Syncing..." : "Force Sync Fleet"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-card/10 gap-1.5 text-xs"
                onClick={handleReconcile}
                disabled={reconciling}
                title="Re-push all synced persons to every mapped device (catches devices that missed a sync while offline)"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${reconciling ? "animate-spin" : ""}`} />
                {reconciling ? "Reconciling..." : "Reconcile Devices"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-card/10 gap-1.5 text-xs"
                onClick={handleCheckExpiredAccess}
                disabled={checkingExpired}
              >
                <ShieldAlert className={`h-3.5 w-3.5 ${checkingExpired ? "animate-spin" : ""}`} />
                {checkingExpired ? "Checking..." : "Revoke Expired"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-device enrolment breakdown (fleet totals live in the health strip above) */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-indigo-50 text-indigo-600">
                <Fingerprint className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Faces Enrolled</p>
                <p className="text-2xl font-bold">{mipsFaces}</p>
                {mipsTotal > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    on {mipsDevices.filter((d) => (d.faceCount || 0) >= mipsFaces).length}/{mipsTotal} devices
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-full ${mipsDrift ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Persons Registered</p>
                <p className="text-2xl font-bold">{mipsPersons}</p>
                {mipsTotal > 1 && (
                  <p className={`text-[11px] ${mipsDrift ? "text-amber-600" : "text-muted-foreground"}`}>
                    on {mipsDevices.filter((d) => (d.personCount || 0) >= mipsPersons).length}/{mipsTotal} devices
                    {mipsDrift ? " · drift" : ""}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <MIPSConnectionCard branchId={branchId} branchName={branchName} />
    </div>
  );
};


// ---------------------------------------------------------------------------
// Admin helper: fetches the MIPS receiver URL (with the shared secret embedded
// as `?token=`) and offers Copy-to-clipboard. Users paste this URL into the
// MIPS device's "Recognition Record Upload URL" field to restore live attendance.
// ---------------------------------------------------------------------------
function MipsWebhookUrlCard() {
  const [state, setState] = useState<{ loading: boolean; url?: string; note?: string; configured?: boolean; error?: string }>({ loading: false });

  const load = async () => {
    setState({ loading: true });
    try {
      const { data, error } = await supabase.functions.invoke("mips-webhook-url", {});
      if (error) throw error;
      const r = data as any;
      setState({ loading: false, url: r?.recognition_url, note: r?.note, configured: Boolean(r?.configured) });
    } catch (e: any) {
      setState({ loading: false, error: e?.message || "Failed" });
    }
  };

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-none">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">MIPS Device Webhook URL</h3>
            <p className="text-xs text-slate-500">Live attendance callback — paste into "Recognition Record Upload URL" on the device.</p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={state.loading} className="rounded-xl">
            {state.loading ? "Loading…" : state.url ? "Refresh" : "Show URL"}
          </Button>
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.url && (
          <div className="space-y-2">
            {!state.configured && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Not configured.</strong> {state.note}
              </div>
            )}
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-mono break-all text-slate-800">{state.url}</code>
              <Button size="sm" onClick={() => { navigator.clipboard.writeText(state.url!); toast.success("URL copied"); }} className="rounded-xl">Copy</Button>
            </div>
            <p className="text-xs text-slate-500">{state.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


export default MIPSDashboard;
