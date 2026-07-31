import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, RefreshCw, Monitor, Activity, Server, Upload, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import AddDeviceDrawer from "@/components/devices/AddDeviceDrawer";
import LiveAccessLog from "@/components/devices/LiveAccessLog";
import MIPSDashboard from "@/components/devices/MIPSDashboard";
import MIPSDevicesTab from "@/components/devices/MIPSDevicesTab";
import PersonnelSyncTab from "@/components/devices/PersonnelSyncTab";
import DeviceHealthStrip from "@/components/devices/DeviceHealthStrip";
import DeviceAttentionBar from "@/components/devices/DeviceAttentionBar";
import DeviceSetupPanel from "@/components/devices/DeviceSetupPanel";
import DeviceDebugPanel from "@/components/devices/DeviceDebugPanel";

const DeviceManagement = () => {
  const { hasAnyRole } = useAuth();
  const isAdminOrOwner = hasAnyRole(["owner", "admin"]);
  const queryClient = useQueryClient();
  const { selectedBranch, branches } = useBranchContext();
  const branchFilter = selectedBranch !== "all" ? selectedBranch : "";
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["mips-connection-test"] });
    queryClient.invalidateQueries({ queryKey: ["mips-devices"] });
    queryClient.invalidateQueries({ queryKey: ["access-devices-sns"] });
    queryClient.invalidateQueries({ queryKey: ["access-logs-last"] });
    queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });
    queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
    toast.info("Refreshing all data...");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-foreground">Device Command Center</h1>
            <p className="text-sm text-muted-foreground">
              MIPS middleware · facial recognition &amp; access control
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
            <Button className="rounded-xl" onClick={() => setIsAddDrawerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </div>
        </div>

        <DeviceHealthStrip branchId={branchFilter || undefined} />
        <DeviceAttentionBar branchId={branchFilter || undefined} />

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/60 p-1">
            <TabsTrigger value="overview" className="gap-1.5 rounded-lg">
              <Server className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="devices" className="gap-1.5 rounded-lg">
              <Monitor className="h-4 w-4" /> Devices
            </TabsTrigger>
            <TabsTrigger value="sync" className="gap-1.5 rounded-lg">
              <Upload className="h-4 w-4" /> Personnel Sync
            </TabsTrigger>
            <TabsTrigger value="live-feed" className="gap-1.5 rounded-lg">
              <Activity className="h-4 w-4" /> Live Feed
            </TabsTrigger>
            {isAdminOrOwner && (
              <TabsTrigger value="setup" className="gap-1.5 rounded-lg">
                <Wrench className="h-4 w-4" /> Setup &amp; Diagnostics
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            <MIPSDashboard
              branchId={branchFilter || undefined}
              branchName={branchFilter ? branches.find((b) => b.id === branchFilter)?.name : undefined}
            />
          </TabsContent>

          <TabsContent value="devices">
            <MIPSDevicesTab branchId={branchFilter || undefined} />
          </TabsContent>

          <TabsContent value="sync">
            <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
              <CardHeader>
                <CardTitle className="text-base">Personnel Sync to MIPS</CardTitle>
                <CardDescription>
                  Push member and staff profiles with face photos to the hardware via MIPS middleware. Verify
                  device-side presence and re-sync stale records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PersonnelSyncTab branchId={branchFilter || undefined} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="live-feed">
            <LiveAccessLog branchId={branchFilter || undefined} limit={50} />
          </TabsContent>

          {isAdminOrOwner && (
            <TabsContent value="setup">
              <div className="space-y-4">
                <DeviceSetupPanel />
                <DeviceDebugPanel branchId={branchFilter || undefined} />
              </div>
            </TabsContent>
          )}
        </Tabs>

        <AddDeviceDrawer
          isOpen={isAddDrawerOpen}
          onClose={() => setIsAddDrawerOpen(false)}
          branches={branches}
          defaultBranchId={branchFilter}
        />
      </div>
    </AppLayout>
  );
};

export default DeviceManagement;
