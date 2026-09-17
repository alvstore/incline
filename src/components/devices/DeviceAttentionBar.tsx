import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ScanFace, WifiOff, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMipsFleet } from "./useMipsFleet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
      <div className={`rounded-full p-1.5 ${tone === "danger" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
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
  const [lastResync, setLastResync] = useState<string | null>(null);
  const { devices, offline, unmapped, laggingGates, actionableDevices, retakeNeeded, target } =
    useMipsFleet(branchId);

  const handleResync = async () => {
    setResyncing(true);
    setLastResync(null);
    try {
      const { data, error } = await supabase.functions.invoke("mips-face-parity", {
        body: { action: "resync", branch_id: branchId, device_ids: actionableDevices.map((d) => d.id) },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      const d = data as { queued_people?: number; queued_dispatches?: number };
      const people = d.queued_people ?? 0;
      if (people === 0) {
        setLastResync("Nothing was queued — no photo on this gate is waiting to be sent right now.");
        toast.info("Nothing to re-send", {
          description: "Every photo we can push is already queued or delivered.",
        });
      } else {
        setLastResync(
          `Queued ${people} ${people === 1 ? "person" : "people"} (${d.queued_dispatches ?? 0} pushes). They are sent in the background over the next few minutes.`,
        );
        toast.success("Re-sync started", {
          description: `${people} queued (${d.queued_dispatches ?? 0} pushes).`,
        });
      }
      qc.invalidateQueries({ queryKey: ["mips-devices"] });
      qc.invalidateQueries({ queryKey: ["mips-face-ledger"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Face re-sync failed";
      setLastResync(`Re-sync failed: ${msg}`);
      toast.error(msg);
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
  if (offline.length === 0 && laggingGates.length === 0 && unmapped.length === 0) return null;

  const canResync = actionableDevices.length > 0;

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

      {laggingGates.length > 0 && (
        <AlertRow
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          message={
            <>
              <strong>Face photos not yet on every gate.</strong>{" "}
              {laggingGates.map((g) => {
                const parts: string[] = [];
                if (g.gapWaiting > 0) parts.push(`${g.gapWaiting} waiting to be sent`);
                if (g.gapRejected > 0) parts.push(`${g.gapRejected} need a clearer photo`);
                return (
                  <span key={g.deviceId} className="block">
                    {g.name}: {g.gapWaiting + g.gapRejected} {g.gapWaiting + g.gapRejected === 1 ? "person" : "people"} missing
                    {parts.length > 0 ? ` — ${parts.join(", ")}` : ""}.
                  </span>
                );
              })}
              {retakeNeeded > 0 && (
                <span className="block pt-1">
                  Re-syncing cannot fix a rejected photo — those {retakeNeeded}{" "}
                  {retakeNeeded === 1 ? "person needs" : "people need"} a new close-up photo in Personnel Sync.
                </span>
              )}
              {lastResync && <span className="block pt-1 font-medium">{lastResync}</span>}
            </>
          }
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  disabled={resyncing || !canResync}
                  title={canResync ? undefined : "Nothing is waiting to be sent to these gates"}
                  className="min-h-[36px] cursor-pointer rounded-xl focus:ring-2 focus:ring-indigo-500"
                >
                  <ScanFace className={`mr-1.5 h-3.5 w-3.5 ${resyncing ? "animate-pulse" : ""}`} />
                  {resyncing ? "Pushing faces…" : "Re-sync faces"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Re-send face photos to these gates?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Each photo makes the terminal rebuild a face record, so they are sent slowly —
                    roughly one every 1–2 seconds. A large batch can take 10–20 minutes to finish.
                    Only start this when the gates are not busy.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                  <AlertDialogAction className="cursor-pointer" onClick={handleResync}>
                    Start re-sync
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
              className="min-h-[36px] rounded-xl"
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
