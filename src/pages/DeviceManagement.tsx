import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RefreshCw, Monitor, Activity, Upload, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import AddDeviceDrawer from "@/components/devices/AddDeviceDrawer";
import LiveAccessLog from "@/components/devices/LiveAccessLog";
import DeviceFleetTab from "@/components/devices/DeviceFleetTab";
import PersonnelSyncTab from "@/components/devices/PersonnelSyncTab";
import DeviceHealthStrip from "@/components/devices/DeviceHealthStrip";
import DeviceAttentionBar from "@/components/devices/DeviceAttentionBar";
import DeviceSetupSheet from "@/components/devices/DeviceSetupSheet";

const DeviceManagement = () => {
  const { hasAnyRole } = useAuth();
  const isAdminOrOwner = hasAnyRole(["owner", "admin"]);
  const queryClient = useQueryClient();
  const { selectedBranch, branches } = useBranchContext();
  const branchFilter = selectedBranch !== "all" ? selectedBranch : "";
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  const refreshAll = () => {
    [
      "mips-connection-test",
      "mips-devices",
      "access-devices-sns",
      "access-logs-last",
      "personnel-sync",
      "access-logs-live",
    ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    toast.info("Refreshing device data…");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-foreground">Device Command Center</h1>
            <p className="text-sm text-muted-foreground">
              MIPS middleware · facial recognition &amp; access control
              {branchFilter && ` · ${branches.find((b) => b.id === branchFilter)?.name ?? ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh all device data"
              className="rounded-xl"
              onClick={refreshAll}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {isAdminOrOwner && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Open device setup and diagnostics"
                className="rounded-xl"
                onClick={() => setIsSetupOpen(true)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            <Button className="rounded-xl" onClick={() => setIsAddDrawerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </div>
        </div>

        <DeviceHealthStrip branchId={branchFilter || undefined} />
        <DeviceAttentionBar branchId={branchFilter || undefined} />

        <Tabs defaultValue="fleet" className="space-y-4">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/60 p-1">
            <TabsTrigger value="fleet" className="gap-1.5 rounded-lg">
              <Monitor className="h-4 w-4" /> Fleet
            </TabsTrigger>
            <TabsTrigger value="sync" className="gap-1.5 rounded-lg">
              <Upload className="h-4 w-4" /> Personnel Sync
            </TabsTrigger>
            <TabsTrigger value="live-feed" className="gap-1.5 rounded-lg">
              <Activity className="h-4 w-4" /> Live Feed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fleet">
            <DeviceFleetTab branchId={branchFilter || undefined} canRunFleetActions={isAdminOrOwner} />
          </TabsContent>

          <TabsContent value="sync">
            <PersonnelSyncTab branchId={branchFilter || undefined} />
          </TabsContent>

          <TabsContent value="live-feed">
            <LiveAccessLog branchId={branchFilter || undefined} limit={50} />
          </TabsContent>
        </Tabs>

        <AddDeviceDrawer
          isOpen={isAddDrawerOpen}
          onClose={() => setIsAddDrawerOpen(false)}
          branches={branches}
          defaultBranchId={branchFilter}
        />

        {isAdminOrOwner && (
          <DeviceSetupSheet
            open={isSetupOpen}
            onClose={() => setIsSetupOpen(false)}
            branchId={branchFilter || undefined}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default DeviceManagement;
