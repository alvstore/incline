import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Monitor, DoorOpen, RotateCcw, Globe, Plus, Download,
} from "lucide-react";
import { fetchMIPSDevices, remoteOpenDoor, restartDevice, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MIPSDeviceCardProps {
  device: MIPSDevice;
  branchName?: string;
  branchId?: string;
  publicIp?: string;
  localDeviceId?: string;
  doorRole?: 'entry' | 'exit' | 'both';
  onRegister?: (device: MIPSDevice) => void;
  registering?: boolean;
}


const MIPSDeviceCard = ({ device, branchName, branchId, publicIp, localDeviceId, doorRole, onRegister, registering }: MIPSDeviceCardProps) => {
  const qc = useQueryClient();
  const isOnline = device.onlineFlag === 1 || device.status === 1;
  const [isOpening, setIsOpening] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [savingRole, setSavingRole] = useState(false);

  const handleOpenDoor = async () => {
    setIsOpening(true);
    try {
      const result = await remoteOpenDoor(device.id, branchId);
      if (result.success) toast.success(`Door opened on ${device.name}`);
      else toast.error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsOpening(false);
    }
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      const result = await restartDevice(device.id, branchId);
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRoleChange = async (val: string) => {
    if (!localDeviceId) return;
    setSavingRole(true);
    try {
      const { error } = await supabase
        .from("access_devices")
        .update({ door_role: val })
        .eq("id", localDeviceId);
      if (error) throw error;
      toast.success(`Role set to ${val}`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to save role");
    } finally {
      setSavingRole(false);
    }
  };


  return (
    <Card className={`rounded-2xl shadow-lg transition-all ${isOnline ? "shadow-success/20 border-success/20" : "shadow-muted/20"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl relative ${isOnline ? "bg-success/10" : "bg-muted"}`}>
              <Monitor className="h-5 w-5" />
              {/* Glowing status dot */}
              <span className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
                isOnline ? "bg-success shadow-[0_0_8px_2px_rgba(34,197,94,0.4)] animate-pulse" : "bg-destructive"
              }`} />
            </div>
            <div>
              <CardTitle className="text-base">{device.name || device.deviceKey}</CardTitle>
              <CardDescription className="text-xs font-mono flex items-center gap-1.5">
                SN: <span className="font-semibold text-foreground">{device.deviceKey}</span>
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={isOnline ? "default" : "destructive"} className="text-xs">
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {branchName && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                {branchName}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Persons</p>
            <p className="text-sm font-bold">{device.personCount || 0}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Faces</p>
            <p className="text-sm font-bold">{device.faceCount || 0}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Last Active</p>
            <p className="text-[10px] font-medium truncate">
              {device.lastActiveTime ? new Date(device.lastActiveTime).toLocaleTimeString() : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2 text-center">
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
              <Globe className="h-2.5 w-2.5" /> Public IP
            </p>
            <p className="text-[10px] font-mono font-medium truncate">{publicIp || device.ip || "—"}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleOpenDoor}
            disabled={!isOnline || isOpening}
          >
            <DoorOpen className={`h-3.5 w-3.5 mr-1.5 ${isOpening ? "animate-pulse" : ""}`} />
            {isOpening ? "Opening..." : "Open Door"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestart}
            disabled={!isOnline || isRestarting}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {localDeviceId && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">Door role</Label>
            <Select value={doorRole || 'both'} onValueChange={handleRoleChange} disabled={savingRole}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entry">Entry only</SelectItem>
                <SelectItem value="exit">Exit only</SelectItem>
                <SelectItem value="both">Entry + Exit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {!localDeviceId && onRegister && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <span className="text-[10px] text-warning uppercase tracking-wider">Not in CRM</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={registering}
              onClick={() => onRegister(device)}
            >
              <Plus className={`h-3 w-3 mr-1 ${registering ? "animate-pulse" : ""}`} />
              Register in CRM
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface MIPSDevicesTabProps {
  branchId?: string;
}

const MIPSDevicesTab = ({ branchId }: MIPSDevicesTabProps) => {
  const qc = useQueryClient();
  const [registeringSN, setRegisteringSN] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const { data: localDevices } = useQuery({
    queryKey: ["access-devices-sns", branchId],
    queryFn: async () => {
      let query = supabase.from("access_devices").select("id, serial_number, branch_id, public_ip, door_role");
      if (branchId) query = query.eq("branch_id", branchId);
      const { data } = await query;
      return data || [];
    },
  });


  const { data: branchesList } = useQuery({
    queryKey: ["branches-list-names"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id, name");
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: devices = [], isLoading, refetch } = useQuery<MIPSDevice[]>({
    queryKey: ["mips-devices", branchId || "all"],
    queryFn: () => fetchMIPSDevices(branchId),
    staleTime: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });


  // Show ALL MIPS-server devices — do not hide unmapped hardware. Instead,
  // surface an inline "Register in CRM" action so operators can adopt new
  // devices in one click.
  const filteredDevices = devices;

  const snToBranch = new Map<string, string>();
  const snToPublicIp = new Map<string, string>();
  const snToLocal = new Map<string, { id: string; door_role?: 'entry' | 'exit' | 'both' }>();
  if (localDevices && branchesList) {
    const branchMap = new Map(branchesList.map((b) => [b.id, b.name]));
    for (const ld of localDevices as any[]) {
      if (ld.serial_number && ld.branch_id) {
        snToBranch.set(ld.serial_number.toUpperCase(), branchMap.get(ld.branch_id) || "");
      }
      if (ld.serial_number && ld.public_ip) {
        snToPublicIp.set(ld.serial_number.toUpperCase(), ld.public_ip);
      }
      if (ld.serial_number && ld.id) {
        snToLocal.set(ld.serial_number.toUpperCase(), { id: ld.id, door_role: ld.door_role });
      }
    }
  }

  const registerDevice = async (device: MIPSDevice) => {
    if (!branchId) {
      toast.error("Select a branch first to register this device");
      return;
    }
    setRegisteringSN(device.deviceKey);
    try {
      const { error } = await supabase.from("access_devices").insert({
        branch_id: branchId,
        serial_number: device.deviceKey,
        device_name: device.name || device.deviceKey,
        ip_address: device.ip || "0.0.0.0",
        mips_device_id: device.id,
        is_online: device.onlineFlag === 1 || device.status === 1,
        door_role: "both",
      });
      if (error) throw error;
      toast.success(`${device.name || device.deviceKey} registered`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to register device");
    } finally {
      setRegisteringSN(null);
    }
  };

  const importAll = async () => {
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
      toast.success(`Imported ${data?.imported ?? 0} device(s), ${data?.updated ?? 0} updated`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const unmappedCount = filteredDevices.filter(
    (d) => !snToLocal.has(d.deviceKey?.toUpperCase())
  ).length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <RotateCcw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (filteredDevices.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted-foreground">
        <Monitor className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">No devices found on MIPS server</p>
        <p className="text-xs mt-1">Make sure the MIPS server is running and devices are connected</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {branchId && unmappedCount > 0 && (
        <Card className="rounded-2xl border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="text-sm">
              <span className="font-semibold text-warning">{unmappedCount}</span>
              <span className="text-muted-foreground"> device(s) on the MIPS server aren't registered in the CRM yet.</span>
            </div>
            <Button size="sm" onClick={importAll} disabled={importing}>
              <Download className={`h-3.5 w-3.5 mr-1.5 ${importing ? "animate-pulse" : ""}`} />
              {importing ? "Importing..." : `Import all ${unmappedCount}`}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {filteredDevices.map((device) => {
          const local = snToLocal.get(device.deviceKey?.toUpperCase());
          return (
            <MIPSDeviceCard
              key={device.id || device.deviceKey}
              device={device}
              branchId={branchId}
              branchName={snToBranch.get(device.deviceKey?.toUpperCase()) || undefined}
              publicIp={snToPublicIp.get(device.deviceKey?.toUpperCase()) || undefined}
              localDeviceId={local?.id}
              doorRole={local?.door_role}
              onRegister={branchId ? registerDevice : undefined}
              registering={registeringSN === device.deviceKey}
            />
          );
        })}
      </div>
    </div>
  );
};

export default MIPSDevicesTab;
