import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Monitor, DoorOpen, RotateCcw, Globe, Plus, ScanFace } from "lucide-react";
import { remoteOpenDoor, restartDevice, type MIPSDevice } from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MIPSDeviceCardProps {
  device: MIPSDevice;
  branchName?: string;
  branchId?: string;
  publicIp?: string;
  localDeviceId?: string;
  doorRole?: "entry" | "exit" | "both";
  onRegister?: () => void;
  registering?: boolean;
}

const Stat = ({ label, value, icon }: { label: React.ReactNode; value: React.ReactNode; icon?: React.ReactNode }) => (
  <div className="rounded-xl bg-muted/50 p-2 text-center">
    <p className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
      {icon}
      {label}
    </p>
    <p className="truncate text-sm font-bold">{value}</p>
  </div>
);

const MIPSDeviceCard = ({
  device,
  branchName,
  branchId,
  publicIp,
  localDeviceId,
  doorRole,
  onRegister,
  registering,
}: MIPSDeviceCardProps) => {
  const qc = useQueryClient();
  const isOnline = device.onlineFlag === 1 || device.status === 1;
  const [isOpening, setIsOpening] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [syncingFaces, setSyncingFaces] = useState(false);

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

  const handleFaceResync = async () => {
    setSyncingFaces(true);
    try {
      const { data, error } = await supabase.functions.invoke("mips-face-parity", {
        body: { action: "resync", branch_id: branchId, device_ids: [device.id] },
      });
      if (error) throw error;
      const d = data as { error?: string; dispatched?: number; total_with_photo?: number; failed?: number; errors?: string[] };
      if (d?.error) throw new Error(d.error);
      toast.success(`Pushed ${d.dispatched ?? 0}/${d.total_with_photo ?? 0} faces to ${device.name || device.deviceKey}`, {
        description: d.failed ? `${d.failed} failed — ${(d.errors || []).slice(0, 2).join("; ")}` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["mips-devices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Face re-sync failed");
    } finally {
      setSyncingFaces(false);
    }
  };

  const handleRoleChange = async (val: string) => {
    if (!localDeviceId) return;
    setSavingRole(true);
    try {
      const { error } = await supabase.from("access_devices").update({ door_role: val }).eq("id", localDeviceId);
      if (error) throw error;
      toast.success(`Role set to ${val}`);
      qc.invalidateQueries({ queryKey: ["access-devices-sns"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save role");
    } finally {
      setSavingRole(false);
    }
  };

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`relative rounded-xl p-2.5 ${isOnline ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              <Monitor className="h-5 w-5" />
              <span
                className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card ${
                  isOnline ? "animate-pulse bg-emerald-500" : "bg-red-500"
                }`}
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{device.name || device.deviceKey}</CardTitle>
              <CardDescription className="truncate font-mono text-xs">
                SN: <span className="font-semibold text-foreground">{device.deviceKey}</span>
              </CardDescription>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isOnline ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              }`}
            >
              {isOnline ? "Online" : "Offline"}
            </Badge>
            {branchName && (
              <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-[10px] text-primary">
                {branchName}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Persons" value={device.personCount || 0} />
          <Stat label="Faces" value={device.faceCount || 0} />
          <Stat
            label="Last active"
            value={device.lastActiveTime ? new Date(device.lastActiveTime).toLocaleTimeString() : "—"}
          />
          <Stat
            icon={<Globe className="h-2.5 w-2.5" />}
            label={publicIp ? "Public IP" : "Device IP"}
            value={<span className="font-mono text-[11px]">{publicIp || device.ip || "—"}</span>}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] flex-1 rounded-xl"
            onClick={handleOpenDoor}
            disabled={!isOnline || isOpening}
          >
            <DoorOpen className={`mr-1.5 h-3.5 w-3.5 ${isOpening ? "animate-pulse" : ""}`} />
            {isOpening ? "Opening…" : "Open door"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] rounded-xl"
            aria-label={`Restart ${device.name || device.deviceKey}`}
            onClick={handleRestart}
            disabled={!isOnline || isRestarting}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[36px] rounded-xl"
            onClick={handleFaceResync}
            disabled={syncingFaces}
            aria-label={`Re-push all enrolled faces to ${device.name || device.deviceKey}`}
          >
            <ScanFace className={`mr-1.5 h-3.5 w-3.5 ${syncingFaces ? "animate-pulse" : ""}`} />
            {syncingFaces ? "Pushing…" : "Faces"}
          </Button>
        </div>

        {localDeviceId ? (
          <div className="flex items-center gap-2 border-t border-border/50 pt-3">
            <Label
              htmlFor={`door-role-${localDeviceId}`}
              className="whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Door role
            </Label>
            <Select value={doorRole || "both"} onValueChange={handleRoleChange} disabled={savingRole}>
              <SelectTrigger id={`door-role-${localDeviceId}`} className="h-8 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entry">Entry only</SelectItem>
                <SelectItem value="exit">Exit only</SelectItem>
                <SelectItem value="both">Entry + Exit</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          onRegister && (
            <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-3">
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-medium text-amber-700">
                Not in CRM
              </span>
              <Button
                size="sm"
                variant="outline"
                className="min-h-[36px] rounded-xl text-xs"
                disabled={registering}
                onClick={onRegister}
              >
                <Plus className={`mr-1 h-3 w-3 ${registering ? "animate-pulse" : ""}`} />
                Register in CRM
              </Button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
};

export default MIPSDeviceCard;
