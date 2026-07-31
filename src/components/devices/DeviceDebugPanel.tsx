import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Bug, Copy, DoorOpen, GitCompare, Monitor, Server, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import {
  testMIPSConnection,
  fetchMIPSDevices,
  fetchMIPSEmployees,
  fetchMIPSPassRecords,
  remoteOpenDoor,
  verifyPersonOnMIPS,
  compareCRMvsMIPS,
} from "@/services/mipsService";
import { supabase } from "@/integrations/supabase/client";

interface DeviceDebugPanelProps {
  branchId?: string;
}

const CHECKLIST = [
  "Test Connection → verify 'Connected' status",
  "Sync member → verify appears in Raw Persons list",
  "Verify member → confirm member code exists on MIPS",
  "Remote open door → verify device relay clicks",
  "Face scan → verify event in Live Feed",
  "CRM vs MIPS → counts should match",
];

const DeviceDebugPanel = ({ branchId }: DeviceDebugPanelProps) => {
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [debugMemberCode, setDebugMemberCode] = useState("");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setDebugResult(`${label}…`);
    try {
      const result = await fn();
      setDebugResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      setDebugResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bug className="h-5 w-5" />
          Debug &amp; Testing Tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Actions</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => run("Testing MIPS connection", () => testMIPSConnection(branchId))}
            >
              <Server className="mr-1.5 h-3.5 w-3.5" /> Test Connection
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                run("Fetching online devices", async () => {
                  const devices = await fetchMIPSDevices(branchId);
                  const online = devices.filter((d) => d.onlineFlag === 1 || d.status === 1);
                  if (online.length === 0) return "No online devices found";
                  return await remoteOpenDoor(online[0].id, branchId);
                })
              }
            >
              <DoorOpen className="mr-1.5 h-3.5 w-3.5" /> Open Door (Auto)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                run("Comparing CRM vs MIPS", async () => {
                  const { count } = await supabase
                    .from("members")
                    .select("id", { count: "exact", head: true })
                    .eq("mips_sync_status", "synced");
                  return await compareCRMvsMIPS(count || 0);
                })
              }
            >
              <GitCompare className="mr-1.5 h-3.5 w-3.5" /> CRM vs MIPS Count
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                run("Sending test webhook payload", async () => {
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
                  return `Payload sent:\n${JSON.stringify(testPayload, null, 2)}\n\nResponse:\n${JSON.stringify(
                    data,
                    null,
                    2
                  )}${error ? `\n\nError: ${error.message}` : ""}`;
                })
              }
            >
              <Activity className="mr-1.5 h-3.5 w-3.5" /> Test Webhook
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="debug-member-code" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Verify Member on MIPS
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="debug-member-code"
              placeholder="Enter member code (e.g. MAIN-00001)"
              value={debugMemberCode}
              onChange={(e) => setDebugMemberCode(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!debugMemberCode) {
                  toast.error("Enter a member code");
                  return;
                }
                run(`Verifying ${debugMemberCode} on MIPS`, () => verifyPersonOnMIPS(debugMemberCode));
              }}
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verify
            </Button>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Raw API Calls</h4>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => run("Fetching MIPS devices", () => fetchMIPSDevices())}>
              <Monitor className="mr-1.5 h-3.5 w-3.5" /> Raw Devices
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => run("Fetching MIPS persons", () => fetchMIPSEmployees(1, 50))}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" /> Raw Persons
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => run("Fetching MIPS pass records", () => fetchMIPSPassRecords())}
            >
              <Activity className="mr-1.5 h-3.5 w-3.5" /> Raw Pass Records
            </Button>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">E2E Test Checklist</h4>
          <div className="space-y-2">
            {CHECKLIST.map((item, i) => (
              <label
                key={i}
                htmlFor={`e2e-${i}`}
                className="flex cursor-pointer items-center gap-3 rounded-xl bg-muted/40 p-2.5 transition-colors hover:bg-muted"
              >
                <input id={`e2e-${i}`} type="checkbox" className="h-4 w-4 rounded border-border" />
                <span className="text-sm">{item}</span>
              </label>
            ))}
          </div>
        </div>

        {debugResult && (
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy debug output"
              className="absolute right-2 top-2 h-6 w-6"
              onClick={() => {
                navigator.clipboard.writeText(debugResult);
                toast.success("Copied");
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <pre className="max-h-96 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-4 text-xs">
              {debugResult}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DeviceDebugPanel;
