import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  });

  const { data: mipsDevices = [] as MIPSDevice[], dataUpdatedAt } = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    enabled: !!mipsConnection?.success,
    staleTime: 10_000,
    refetchInterval: 15_000,
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

  const mipsOnline = mipsDevices.filter((d) => (d.onlineFlag === 1 || d.status === 1)).length;
  const mipsTotal = mipsDevices.length;
  const mipsFaces = mipsDevices.reduce((sum, d) => sum + (d.faceCount || 0), 0);
  const mipsPersons = mipsDevices.reduce((sum, d) => sum + (d.personCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Hero Card with glassmorphism */}
      <Card className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.15)_0%,_transparent_60%)]" />
        <CardContent className="p-6 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
                <Server className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold">MIPS Middleware Server</h3>
                <p className="text-sm text-white/70">Smart Pass v3 • RuoYi Cloud Integration</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={`border-white/30 ${
                  mipsConnection?.success
                    ? "bg-green-500/20 text-green-200"
                    : "bg-destructive/20 text-red-200"
                }`}
              >
                <div className={`h-2 w-2 rounded-full mr-1.5 ${
                  mipsConnection?.success
                    ? "bg-green-400 shadow-[0_0_6px_2px_rgba(34,197,94,0.5)] animate-pulse"
                    : "bg-red-400 shadow-[0_0_6px_2px_rgba(239,68,68,0.5)]"
                }`} />
                {isTestingConnection ? "Testing..." : mipsConnection?.success ? "Connected" : "Disconnected"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => retestConnection()}
              >
                <RefreshCw className={`h-4 w-4 ${isTestingConnection ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <Heart className={`h-3 w-3 transition-transform ${heartbeatPulse ? "scale-150 text-red-300" : "scale-100"}`} />
              <span>Last checked: {formatDistanceToNow(lastChecked, { addSuffix: true })}</span>
              <span className="text-white/30">• Auto-refresh 15s</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5 text-xs"
                onClick={handleFleetSync}
                disabled={syncingFleet}
              >
                <Zap className={`h-3.5 w-3.5 ${syncingFleet ? "animate-pulse" : ""}`} />
                {syncingFleet ? "Syncing..." : "Force Sync Fleet"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5 text-xs"
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

      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl shadow-lg shadow-muted/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-primary/10">
                <Monitor className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Devices</p>
                <p className="text-2xl font-bold">{mipsTotal}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-lg shadow-muted/20 relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-green-500/10 relative">
                {mipsOnline > 0 ? (
                  <>
                    <Wifi className="h-5 w-5 text-green-500" />
                    <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-30" />
                  </>
                ) : (
                  <WifiOff className="h-5 w-5 text-destructive" />
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Online</p>
                <p className="text-2xl font-bold text-green-600">
                  {mipsOnline}
                  <span className="text-sm font-normal text-muted-foreground">/{mipsTotal}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-lg shadow-muted/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-blue-500/10">
                <Fingerprint className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Faces Enrolled</p>
                <p className="text-2xl font-bold">{mipsFaces}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-lg shadow-muted/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-orange-500/10">
                <Users className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Persons Registered</p>
                <p className="text-2xl font-bold">{mipsPersons}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <MIPSConnectionCard branchId={branchId} branchName={branchName} />
    </div>
  );
};

export default MIPSDashboard;
