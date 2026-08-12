import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, Save, ServerCog, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMipsCallbackUrls } from "@/hooks/useMipsCallbackUrls";
import { getMIPSConnection, saveAndTestMIPSConnection, testMIPSConnection, testMIPSCredentials, verifyPersonOnMIPS } from "@/services/mipsService";

interface DeviceSetupSheetProps {
  open: boolean;
  onClose: () => void;
  branchId?: string;
}

const UrlField = ({
  step,
  stepClass,
  title,
  hint,
  url,
  required,
  readOnly,
}: {
  step: number;
  stepClass: string;
  title: string;
  hint: string;
  url: string;
  required?: boolean;
  readOnly?: boolean;
}) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${stepClass}`}>
        {step}
      </span>
      {title}
      {required && <span className="text-destructive">*</span>}
    </div>
    <p className="text-[11px] text-muted-foreground">{hint}</p>
    <div className="flex items-center gap-2 rounded-xl bg-muted p-2.5">
      <code className={`flex-1 break-all font-mono text-xs ${readOnly ? "text-muted-foreground" : ""}`}>
        {url || "Loading…"}
      </code>
      {!readOnly && (
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copy ${title}`}
          className="h-8 w-8 shrink-0 rounded-lg"
          disabled={!url}
          onClick={() => {
            navigator.clipboard.writeText(url);
            toast.success(`${title} copied`);
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      )}
    </div>
  </div>
);

const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-2xl bg-muted/30 p-4">
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const DeviceSetupSheet = ({ open, onClose, branchId }: DeviceSetupSheetProps) => {
  const queryClient = useQueryClient();
  const { data: mipsUrls } = useMipsCallbackUrls();
  const recognitionUrl = mipsUrls?.receiver || "";

  const [tokenState, setTokenState] = useState<{
    loading: boolean;
    url?: string;
    note?: string;
    configured?: boolean;
    error?: string;
  }>({ loading: false });

  const [memberCode, setMemberCode] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [credentials, setCredentials] = useState({ server_url: "", username: "", password: "" });

  const connectionQuery = useQuery({
    queryKey: ["mips-connection-config", branchId],
    queryFn: () => getMIPSConnection(branchId as string),
    enabled: open && Boolean(branchId),
    retry: false,
  });

  useEffect(() => {
    const connection = connectionQuery.data;
    if (connection) setCredentials({ server_url: connection.server_url, username: connection.username, password: "" });
  }, [connectionQuery.data]);

  const connectionMutation = useMutation({
    mutationFn: async (save: boolean) => {
      if (!branchId) throw new Error("Select a branch before managing its MIPS connection.");
      if (!credentials.server_url.trim() || !credentials.username.trim()) throw new Error("Server URL and username are required.");
      const action = save ? saveAndTestMIPSConnection : testMIPSCredentials;
      return action(branchId, { server_url: credentials.server_url.trim(), username: credentials.username.trim(), password: credentials.password || undefined });
    },
    onSuccess: (result, save) => {
      setConnectionResult({ success: true, message: save ? `Saved. ${result.message}` : result.message });
      if (save) {
        setCredentials((current) => ({ ...current, password: "" }));
        ["mips-connection-config", "mips-connection", "mips-connection-test", "mips-devices", "access-devices-sns"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
        toast.success("MIPS connection saved and verified");
      }
    },
    onError: (error: Error) => setConnectionResult({ success: false, message: error.message }),
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setRunning(true);
    setOutput(`${label}…`);
    try {
      const result = await fn();
      setOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const loadToken = async () => {
    setTokenState({ loading: true });
    try {
      const { data, error } = await supabase.functions.invoke("mips-webhook-url", {});
      if (error) throw error;
      const r = data as { recognition_url?: string; note?: string; configured?: boolean };
      setTokenState({ loading: false, url: r?.recognition_url, note: r?.note, configured: Boolean(r?.configured) });
    } catch (e) {
      setTokenState({ loading: false, error: e instanceof Error ? e.message : "Failed" });
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Device Setup &amp; Diagnostics</SheetTitle>
          <SheetDescription>
            Callback URLs for the MIPS admin panel plus the checks used when live attendance stops arriving.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 pb-10">
          <Section title="MIPS server connection" icon={<ServerCog className="h-3.5 w-3.5" />}>
            {!branchId ? (
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Select one branch from the header to manage its MIPS connection.</p>
            ) : connectionQuery.isLoading ? (
              <div className="flex min-h-24 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="mips-server-url">Server URL</Label><Input id="mips-server-url" inputMode="url" placeholder="http://server-address:port" value={credentials.server_url} onChange={(event) => { setCredentials((current) => ({ ...current, server_url: event.target.value })); setConnectionResult(null); }} /></div>
                <div className="space-y-1.5"><Label htmlFor="mips-username">Username</Label><Input id="mips-username" autoComplete="username" value={credentials.username} onChange={(event) => { setCredentials((current) => ({ ...current, username: event.target.value })); setConnectionResult(null); }} /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="mips-password">Password</Label>
                  <div className="relative">
                    <Input id="mips-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder={connectionQuery.data?.has_password ? "Leave blank to keep saved password" : "Enter password"} value={credentials.password} onChange={(event) => { setCredentials((current) => ({ ...current, password: event.target.value })); setConnectionResult(null); }} className="pr-12" />
                    <Button type="button" variant="ghost" size="icon" aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-0 top-0 h-11 w-11" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">The saved password is never displayed.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={connectionMutation.isPending} onClick={() => connectionMutation.mutate(false)} className="min-h-11 rounded-xl">{connectionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}Test entered details</Button>
                  <Button type="button" disabled={connectionMutation.isPending} onClick={() => connectionMutation.mutate(true)} className="min-h-11 rounded-xl">{connectionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save &amp; test</Button>
                </div>
                {connectionResult && <div className={`flex gap-2 rounded-xl p-3 text-xs ${connectionResult.success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{connectionResult.message}</span></div>}
              </div>
            )}
          </Section>

          <Section title="MIPS callback configuration" icon={<ServerCog className="h-3.5 w-3.5" />}>
            <p className="text-[11px] text-muted-foreground">
              Enter these in <strong>MIPS Admin Panel → Device Management → Configure → Server Configuration</strong>.
            </p>
            <UrlField
              step={1}
              stepClass="bg-emerald-100 text-emerald-700"
              title="Recognition Record Upload URL"
              hint="Face scan events — the critical URL for attendance"
              url={recognitionUrl}
              required
            />
            {mipsUrls?.isOverridden && (
              <p className="text-[10px] text-amber-600">Using override from integration settings.</p>
            )}
            <UrlField
              step={2}
              stepClass="bg-indigo-100 text-indigo-700"
              title="Register Person Data Upload URL"
              hint="Captured registration photos from the device"
              url={recognitionUrl}
            />
            <UrlField
              step={3}
              stepClass="bg-slate-100 text-slate-600"
              title="Device Heartbeat Upload URL"
              hint="Keep the device default — not required for attendance"
              url="http://212.38.94.228:9000/api/callback/heartbeat"
              readOnly
            />
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-background p-3 text-[11px] text-muted-foreground">
              <span className="rounded bg-indigo-100 px-2 py-1 font-medium text-indigo-700">Device</span>
              <span>→</span>
              <span className="rounded bg-emerald-100 px-2 py-1 font-medium text-emerald-700">Our webhook</span>
              <span>→</span>
              <span className="rounded bg-violet-100 px-2 py-1 font-medium text-violet-700">MIPS server</span>
              <span>Attendance is processed first, then relayed so both systems stay in sync.</span>
            </div>
          </Section>

          <Section title="Tokenised webhook URL" icon={<KeyRound className="h-3.5 w-3.5" />}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                Includes the shared secret. Use this exact URL if live attendance stops arriving.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={loadToken}
                disabled={tokenState.loading}
                className="min-h-[36px] shrink-0 rounded-xl"
              >
                {tokenState.loading ? "Loading…" : tokenState.url ? "Refresh" : "Show URL"}
              </Button>
            </div>
            {tokenState.error && <p className="text-sm text-red-600">{tokenState.error}</p>}
            {tokenState.url && (
              <div className="space-y-2">
                {!tokenState.configured && (
                  <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    <strong>Not configured.</strong> {tokenState.note}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-xl bg-background px-3 py-2 font-mono text-xs">
                    {tokenState.url}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Copy tokenised webhook URL"
                    className="h-8 w-8 shrink-0 rounded-lg"
                    onClick={() => {
                      navigator.clipboard.writeText(tokenState.url as string);
                      toast.success("URL copied");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </Section>

          <Section title="Diagnostics" icon={<Activity className="h-3.5 w-3.5" />}>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[36px] rounded-xl"
                disabled={running}
                onClick={() => run("Testing MIPS connection", () => testMIPSConnection(branchId))}
              >
                <ServerCog className="mr-1.5 h-3.5 w-3.5" /> Test connection
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[36px] rounded-xl"
                disabled={running}
                onClick={() =>
                  run("Sending test webhook payload", async () => {
                    const payload = {
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
                    const { data, error } = await supabase.functions.invoke("mips-webhook-receiver", { body: payload });
                    if (error) throw error;
                    return data;
                  })
                }
              >
                <Activity className="mr-1.5 h-3.5 w-3.5" /> Simulate webhook
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="verify-person-code" className="text-xs font-semibold">
                Verify a person on MIPS
              </Label>
              <div className="flex gap-2">
                <Input
                  id="verify-person-code"
                  placeholder="Member / staff code, e.g. INC-26-0004"
                  value={memberCode}
                  onChange={(e) => setMemberCode(e.target.value)}
                  className="rounded-xl"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] shrink-0 rounded-xl"
                  disabled={running}
                  onClick={() => {
                    if (!memberCode) {
                      toast.error("Enter a code first");
                      return;
                    }
                    run(`Verifying ${memberCode}`, () => verifyPersonOnMIPS(memberCode, branchId));
                  }}
                >
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verify
                </Button>
              </div>
            </div>

            {output && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy diagnostics output"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => {
                    navigator.clipboard.writeText(output);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-background p-4 text-xs">
                  {output}
                </pre>
              </div>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default DeviceSetupSheet;
