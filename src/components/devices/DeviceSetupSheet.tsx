import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Copy, KeyRound, ServerCog, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMipsCallbackUrls } from "@/hooks/useMipsCallbackUrls";
import { testMIPSConnection, verifyPersonOnMIPS } from "@/services/mipsService";

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
                    run(`Verifying ${memberCode}`, () => verifyPersonOnMIPS(memberCode));
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
