import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Plus, RefreshCw, Users, Monitor, Activity, Bug, Copy, Server, Upload,
  DoorOpen, ShieldCheck, GitCompare,
} from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import AddDeviceDrawer from "@/components/devices/AddDeviceDrawer";
import LiveAccessLog from "@/components/devices/LiveAccessLog";
import MIPSDashboard from "@/components/devices/MIPSDashboard";
import MIPSDevicesTab from "@/components/devices/MIPSDevicesTab";
import PersonnelSyncTab from "@/components/devices/PersonnelSyncTab";
import {
  testMIPSConnection, fetchMIPSDevices, fetchMIPSEmployees, fetchMIPSPassRecords,
  remoteOpenDoor, verifyPersonOnMIPS, compareCRMvsMIPS,
} from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";
import { useMipsCallbackUrls } from "@/hooks/useMipsCallbackUrls";

const DeviceManagement = () => {
  const { hasAnyRole } = useAuth();
  const isAdminOrOwner = hasAnyRole(["owner", "admin"]);
  const queryClient = useQueryClient();
  const { selectedBranch, branches } = useBranchContext();
  const { data: mipsUrls } = useMipsCallbackUrls();
  const recognitionUrl = mipsUrls?.receiver || '';
  const branchFilter = selectedBranch !== "all" ? selectedBranch : "";
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [debugMemberCode, setDebugMemberCode] = useState("");

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["mips-connection-test"] });
    queryClient.invalidateQueries({ queryKey: ["mips-devices"] });
    queryClient.invalidateQueries({ queryKey: ["personnel-sync"] });
    queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
    toast.info("Refreshing all data...");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Device Command Center</h1>
            <p className="text-muted-foreground">
              MIPS Middleware Integration • Facial Recognition & Access Control
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={() => setIsAddDrawerOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Device
            </Button>
          </div>
        </div>

        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList className="bg-muted/60">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <Server className="h-4 w-4" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="devices" className="gap-1.5">
              <Monitor className="h-4 w-4" /> Devices
            </TabsTrigger>
            <TabsTrigger value="sync" className="gap-1.5">
              <Upload className="h-4 w-4" /> Personnel Sync
            </TabsTrigger>
            <TabsTrigger value="live-feed" className="gap-1.5">
              <Activity className="h-4 w-4" /> Live Feed
            </TabsTrigger>
            {isAdminOrOwner && (
              <TabsTrigger value="debug" className="gap-1.5">
                <Bug className="h-4 w-4" /> Debug
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="dashboard">
            <MIPSDashboard
              branchId={branchFilter || undefined}
              branchName={branchFilter ? branches.find(b => b.id === branchFilter)?.name : undefined}
            />
          </TabsContent>

          <TabsContent value="devices">
            <MIPSDevicesTab branchId={branchFilter || undefined} />
          </TabsContent>

          <TabsContent value="sync">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base">Personnel Sync to MIPS</CardTitle>
                <CardDescription>
                  Push member and staff profiles with face photos to the hardware via MIPS middleware.
                  Verify device-side presence and re-sync stale records.
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
            <TabsContent value="debug">
              <div className="space-y-4">
                {/* Webhook URL Guidance — field-by-field */}
                <Card className="rounded-2xl border-primary/20 bg-gradient-to-br from-primary/5 to-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Server className="h-5 w-5 text-primary" />
                      MIPS Device Callback Configuration
                    </CardTitle>
                    <CardDescription>
                      Enter these URLs in your <strong>MIPS Admin Panel → Device Management → Configure → Server Configuration</strong> tab.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Recognition Record Upload URL */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success text-[10px] font-bold">1</span>
                        Recognition Record Upload URL <span className="text-destructive">*</span>
                      </label>
                      <p className="text-[11px] text-muted-foreground">Face scan events — this is the <strong>critical</strong> URL for attendance</p>
                      <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
                        <code className="text-xs font-mono flex-1 break-all">
                          {recognitionUrl || 'Loading…'}
                        </code>
                        <Button variant="outline" size="icon" className="shrink-0 h-7 w-7" disabled={!recognitionUrl} onClick={() => {
                          navigator.clipboard.writeText(recognitionUrl);
                          toast.success("Recognition URL copied");
                        }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {mipsUrls?.isOverridden && (
                        <p className="text-[10px] text-warning">Using override from integration settings.</p>
                      )}
                    </div>

                    {/* Register Person Data Upload URL */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-info/15 text-info text-[10px] font-bold">2</span>
                        Register Person Data Upload URL
                      </label>
                      <p className="text-[11px] text-muted-foreground">Captured registration photos from the device</p>
                      <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
                        <code className="text-xs font-mono flex-1 break-all">
                          {recognitionUrl || 'Loading…'}
                        </code>
                        <Button variant="outline" size="icon" className="shrink-0 h-7 w-7" disabled={!recognitionUrl} onClick={() => {
                          navigator.clipboard.writeText(recognitionUrl);
                          toast.success("Register URL copied");
                        }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Device Heartbeat Upload URL */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-bold">3</span>
                        Device Heartbeat Upload URL
                      </label>
                      <p className="text-[11px] text-muted-foreground">Keep default — not required for attendance</p>
                      <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
                        <code className="text-xs font-mono flex-1 break-all text-muted-foreground">
                          http://212.38.94.228:9000/api/callback/heartbeat
                        </code>
                      </div>
                    </div>

                    {/* Relay diagram */}
                    <div className="rounded-xl border bg-background p-3 space-y-2">
                      <h4 className="text-xs font-semibold flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-primary" /> Data Flow (Relay Mode)
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                        <span className="px-2 py-1 rounded bg-primary/15 text-primary font-medium">Device</span>
                        <span>→</span>
                        <span className="px-2 py-1 rounded bg-success/15 text-success font-medium">Our Webhook</span>
                        <span className="text-[10px]">(log + attendance)</span>
                        <span>→</span>
                        <span className="px-2 py-1 rounded bg-info/15 text-info font-medium">MIPS Server</span>
                        <span className="text-[10px]">(auto-forwarded)</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Our system processes attendance first, then relays the data to MIPS so both systems stay in sync.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bug className="h-5 w-5" />
                      Debug & Testing Tools
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                {/* Quick Actions */}
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Quick Actions</h4>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Testing MIPS connection...");
                            const result = await testMIPSConnection(branchFilter || undefined);
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <Server className="h-3.5 w-3.5 mr-1.5" /> Test Connection
                        </Button>

                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Fetching online devices...");
                            const devices = await fetchMIPSDevices(branchFilter || undefined);
                            const online = devices.filter(d => d.onlineFlag === 1 || d.status === 1);
                            if (online.length === 0) { setDebugResult("No online devices found"); return; }
                            setDebugResult(`Opening door on device ${online[0].id} (${online[0].name})...`);
                            const result = await remoteOpenDoor(online[0].id, branchFilter || undefined);
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <DoorOpen className="h-3.5 w-3.5 mr-1.5" /> Open Door (Auto)
                        </Button>

                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Comparing CRM vs MIPS...");
                            const { count } = await supabase
                              .from("members")
                              .select("id", { count: "exact", head: true })
                              .eq("mips_sync_status", "synced");
                            const result = await compareCRMvsMIPS(count || 0);
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <GitCompare className="h-3.5 w-3.5 mr-1.5" /> CRM vs MIPS Count
                        </Button>

                        <Button variant="secondary" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Sending test webhook payload...");
                            const testPayload = {
                              personNo: "TEST00001",
                              personName: "Webhook Test",
                              passType: "face_0",
                              deviceKey: "TEST-DEVICE",
                              deviceName: "Test Device",
                              createTime: new Date().toISOString(),
                              searchScore: "0.99",
                              livenessScore: "0.99",
                              _test: true,
                            };
                            const { data, error } = await supabase.functions.invoke("mips-webhook-receiver", {
                              body: testPayload,
                            });
                            setDebugResult(
                              `✅ Webhook responded!\n\nPayload sent:\n${JSON.stringify(testPayload, null, 2)}\n\nResponse:\n${JSON.stringify(data, null, 2)}${error ? `\n\nError: ${error.message}` : ""}`
                            );
                          } catch (err: any) { setDebugResult(`❌ Webhook test failed: ${err.message}`); }
                        }}>
                          <Activity className="h-3.5 w-3.5 mr-1.5" /> Test Webhook
                        </Button>
                      </div>
                    </div>

                    {/* Verify Single Member */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Verify Member on MIPS</h4>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter member code (e.g. MAIN-00001)"
                          value={debugMemberCode}
                          onChange={(e) => setDebugMemberCode(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button variant="outline" size="sm" onClick={async () => {
                          if (!debugMemberCode) { toast.error("Enter a member code"); return; }
                          try {
                            setDebugResult(`Verifying ${debugMemberCode} on MIPS...`);
                            const result = await verifyPersonOnMIPS(debugMemberCode);
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Verify
                        </Button>
                      </div>
                    </div>

                    {/* Raw API calls */}
                    <div>
                      <h4 className="text-sm font-semibold mb-3">Raw API Calls</h4>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Fetching MIPS devices...");
                            const devices = await fetchMIPSDevices();
                            setDebugResult(JSON.stringify(devices, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <Monitor className="h-3.5 w-3.5 mr-1.5" /> Raw Devices
                        </Button>
                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Fetching MIPS persons...");
                            const result = await fetchMIPSEmployees(1, 50);
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <Users className="h-3.5 w-3.5 mr-1.5" /> Raw Persons
                        </Button>
                        <Button variant="outline" size="sm" onClick={async () => {
                          try {
                            setDebugResult("Fetching MIPS pass records...");
                            const result = await fetchMIPSPassRecords();
                            setDebugResult(JSON.stringify(result, null, 2));
                          } catch (err: any) { setDebugResult(`Error: ${err.message}`); }
                        }}>
                          <Activity className="h-3.5 w-3.5 mr-1.5" /> Raw Pass Records
                        </Button>
                      </div>
                    </div>

                    {/* E2E Checklist */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2">E2E Test Checklist</h4>
                      <div className="space-y-2">
                        {[
                          "Test Connection → verify 'Connected' status",
                          "Sync member → verify appears in Raw Persons list",
                          "Verify member → confirm member code exists on MIPS",
                          "Remote open door → verify device relay clicks",
                          "Face scan → verify event in Live Feed",
                          "CRM vs MIPS → counts should match",
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 border">
                            <input type="checkbox" className="h-4 w-4 rounded border-border" />
                            <span className="text-sm">{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Debug output */}
                    {debugResult && (
                      <div className="relative">
                        <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6"
                          onClick={() => { navigator.clipboard.writeText(debugResult); toast.success("Copied"); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto max-h-96 whitespace-pre-wrap break-all">
                          {debugResult}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
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
