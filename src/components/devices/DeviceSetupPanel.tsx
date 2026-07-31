import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Copy, Server } from "lucide-react";
import { toast } from "sonner";
import { useMipsCallbackUrls } from "@/hooks/useMipsCallbackUrls";

const UrlField = ({
  step,
  stepClass,
  title,
  hint,
  url,
  required,
  copyLabel,
  readOnly,
}: {
  step: number;
  stepClass: string;
  title: string;
  hint: string;
  url: string;
  required?: boolean;
  copyLabel?: string;
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
          aria-label={copyLabel || `Copy ${title}`}
          className="h-7 w-7 shrink-0"
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

// Admin helper: fetches the MIPS receiver URL with the shared secret embedded
// as `?token=` — paste into the device's "Recognition Record Upload URL" field.
const SecureWebhookUrlCard = () => {
  const [state, setState] = useState<{
    loading: boolean;
    url?: string;
    note?: string;
    configured?: boolean;
    error?: string;
  }>({ loading: false });

  const load = async () => {
    setState({ loading: true });
    try {
      const { data, error } = await supabase.functions.invoke("mips-webhook-url", {});
      if (error) throw error;
      const r = data as { recognition_url?: string; note?: string; configured?: boolean };
      setState({ loading: false, url: r?.recognition_url, note: r?.note, configured: Boolean(r?.configured) });
    } catch (e) {
      setState({ loading: false, error: e instanceof Error ? e.message : "Failed" });
    }
  };

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
      <CardContent className="space-y-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">Tokenised Webhook URL</h3>
            <p className="text-xs text-muted-foreground">
              Includes the shared secret. Use this exact URL if live attendance stops arriving.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={state.loading} className="rounded-xl">
            {state.loading ? "Loading…" : state.url ? "Refresh" : "Show URL"}
          </Button>
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.url && (
          <div className="space-y-2">
            {!state.configured && (
              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Not configured.</strong> {state.note}
              </div>
            )}
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs">{state.url}</code>
              <Button
                size="sm"
                className="rounded-xl"
                onClick={() => {
                  navigator.clipboard.writeText(state.url!);
                  toast.success("URL copied");
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{state.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const DeviceSetupPanel = () => {

  const { data: mipsUrls } = useMipsCallbackUrls();
  const recognitionUrl = mipsUrls?.receiver || "";

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-5 w-5 text-primary" />
          MIPS Device Callback Configuration
        </CardTitle>
        <CardDescription>
          Enter these URLs in your <strong>MIPS Admin Panel → Device Management → Configure → Server Configuration</strong>{" "}
          tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UrlField
          step={1}
          stepClass="bg-emerald-100 text-emerald-700"
          title="Recognition Record Upload URL"
          hint="Face scan events — this is the critical URL for attendance"
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
          hint="Keep default — not required for attendance"
          url="http://212.38.94.228:9000/api/callback/heartbeat"
          readOnly
        />

        <div className="space-y-2 rounded-xl bg-muted/40 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold">
            <Activity className="h-3.5 w-3.5 text-primary" /> Data Flow (Relay Mode)
          </h4>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded bg-indigo-100 px-2 py-1 font-medium text-indigo-700">Device</span>
            <span>→</span>
            <span className="rounded bg-emerald-100 px-2 py-1 font-medium text-emerald-700">Our Webhook</span>
            <span className="text-[10px]">(log + attendance)</span>
            <span>→</span>
            <span className="rounded bg-violet-100 px-2 py-1 font-medium text-violet-700">MIPS Server</span>
            <span className="text-[10px]">(auto-forwarded)</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Our system processes attendance first, then relays the data to MIPS so both systems stay in sync.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeviceSetupPanel;
