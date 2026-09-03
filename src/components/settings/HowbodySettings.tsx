// Body Scanner integration settings — 3-tab Vuexy layout.
// Tabs: Credentials · Webhooks · Devices
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy, Loader2, ScanLine, CheckCircle2, XCircle, Eye, EyeOff,
  KeyRound, Save, Database, Server, Webhook, Cpu, Info,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { HowbodyDevicesCard } from "./HowbodyDevicesCard";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";

interface CredsState {
  configured: boolean;
  source: "db" | "env" | "none";
  is_active: boolean;
  base_url: string;
  username: string;
  app_key_masked: string;
  has_app_key: boolean;
}

export function HowbodySettings() {
  const { toast } = useToast();

  // ---- Credentials ----
  const [loading, setLoading] = useState(true);
  const [creds, setCreds] = useState<CredsState | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appKey, setAppKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---- Test connection ----
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function loadCreds() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("howbody-save-credentials", { method: "GET" });
    if (!error && data?.ok) {
      const c = data as CredsState;
      setCreds(c);
      setBaseUrl(c.base_url || "https://prodapi.howbodyfit.com/howbody-admin");
      setUsername(c.username || "");
      setAppKey("");
      setIsActive(c.is_active);
    }
    setLoading(false);
  }
  useEffect(() => { loadCreds(); }, []);

  async function saveCreds() {
    if (!baseUrl.trim() || !username.trim()) {
      toast({ title: "Missing fields", description: "Base URL and Username are required.", variant: "destructive" });
      return;
    }
    if (!creds?.has_app_key && !appKey.trim()) {
      toast({ title: "App Key required", description: "Paste the App Key for first-time setup.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("howbody-save-credentials", {
      method: "POST",
      body: { base_url: baseUrl.trim(), username: username.trim(), app_key: appKey.trim(), is_active: isActive },
    });
    setSaving(false);
    if (error || !data?.ok) {
      toast({ title: "Save failed", description: data?.error || error?.message || "Unknown error", variant: "destructive" });
      return;
    }
    toast({ title: "Credentials saved", description: "HOWBODY now uses these credentials live." });
    setAppKey("");
    setTestResult(null);
    await loadCreds();
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    const { data, error } = await supabase.functions.invoke("howbody-test-connection");
    if (error || !data?.ok) {
      setTestResult({ ok: false, msg: data?.error || error?.message || "Test failed" });
    } else {
      setTestResult({ ok: true, msg: `Token cached, expires ${new Date(data.expires_at).toLocaleString()}` });
    }
    setTesting(false);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // Webhook URLs — clearly labeled by vendor doc section
  const webhookUrls = [
    {
      key: "qr-login",
      label: "Pre-scan QR Login URL",
      hint: "Vendor doc §3.1 — device APPENDS ?equipmentNo=…&scanId=… automatically.",
      value: `${origin}/scan-login`,
      tag: "Dynamic params",
      tagCls: "border-success/25 bg-success/10 text-success",
    },
    {
      key: "send-to-phone",
      label: "Post-scan Redirect URL (Send to Phone)",
      hint: "Vendor doc §3.2 — STATIC URL, no parameters. Member must be logged in.",
      value: `${origin}/my-scan-report`,
      tag: "Static",
      tagCls: "border-warning/25 bg-warning/10 text-warning",
    },
    {
      key: "body-webhook",
      label: "Body Composition Push Webhook",
      hint: "Vendor doc §3.4 — receives body composition results. Auto-fires WhatsApp + Email delivery.",
      value: `${SUPABASE_URL}/functions/v1/howbody-body-webhook`,
      tag: "Inbound POST",
      tagCls: "border-primary/25 bg-primary/10 text-primary",
    },
    {
      key: "posture-webhook",
      label: "Posture Push Webhook",
      hint: "Vendor doc §3.3 — receives posture analysis. Auto-fires WhatsApp + Email delivery.",
      value: `${SUPABASE_URL}/functions/v1/howbody-posture-webhook`,
      tag: "Inbound POST",
      tagCls: "border-primary/25 bg-primary/10 text-primary",
    },
  ];

  const sourceBadge = creds?.source === "db"
    ? { label: "Configured (Database)", cls: "border-success/25 bg-success/10 text-success", icon: Database }
    : creds?.source === "env"
      ? { label: "Using env fallback", cls: "border-warning/25 bg-warning/10 text-warning", icon: Server }
      : { label: "Not configured", cls: "border-destructive/25 bg-destructive/10 text-destructive", icon: XCircle };
  const SourceIcon = sourceBadge.icon;

  return (
    <Tabs defaultValue="credentials" className="w-full">
      <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-muted p-1">
        <TabsTrigger value="credentials" className="rounded-xl gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
          <KeyRound className="h-4 w-4" /> Credentials
        </TabsTrigger>
        <TabsTrigger value="webhooks" className="rounded-xl gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
          <Webhook className="h-4 w-4" /> Webhooks
        </TabsTrigger>
        <TabsTrigger value="devices" className="rounded-xl gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
          <Cpu className="h-4 w-4" /> Devices
        </TabsTrigger>
      </TabsList>

      {/* === Tab 1: Credentials === */}
      <TabsContent value="credentials" className="mt-6 space-y-6">
        <Card className="rounded-2xl p-6 shadow-lg shadow/50">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2 text-primary"><KeyRound className="h-5 w-5" /></div>
              <div>
                <h2 className="text-lg font-bold">HOWBODY Credentials</h2>
                <p className="text-sm text-muted-foreground">
                  Stored securely in the database. Edge functions read these dynamically — no redeploy needed.
                </p>
              </div>
            </div>
            <Badge variant="outline" className={sourceBadge.cls}>
              <SourceIcon className="mr-1 h-3 w-3" /> {sourceBadge.label}
            </Badge>
          </div>

          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <Label htmlFor="hb-base">Base URL</Label>
                <Input
                  id="hb-base"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://prodapi.howbodyfit.com/howbody-admin"
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="hb-user">Username</Label>
                <Input
                  id="hb-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="TechnicalSupport20264..."
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="hb-key">App Key</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="hb-key"
                    type={showKey ? "text" : "password"}
                    value={appKey}
                    onChange={(e) => setAppKey(e.target.value)}
                    placeholder={creds?.has_app_key ? `Saved: ${creds.app_key_masked} — leave blank to keep` : "Paste App Key"}
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" size="icon" type="button" onClick={() => setShowKey((s) => !s)}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Provided by HOWBODY. Used for both outbound API calls and inbound webhook verification.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-muted p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Disable to fall back to env vars (if configured).</p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>

              <Button onClick={saveCreds} disabled={saving} className="w-full bg-primary hover:bg-primary">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save credentials
              </Button>
            </div>
          )}
        </Card>

        {/* Test connection */}
        <Card className="rounded-2xl p-6 shadow-lg shadow/50">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-success/10 p-2 text-success"><CheckCircle2 className="h-5 w-5" /></div>
            <div className="flex-1">
              <h3 className="text-base font-bold">Test connection</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Verifies the configured credentials by requesting a fresh API token from HOWBODY.
              </p>
            </div>
          </div>
          <Button onClick={runTest} disabled={testing} className="mt-4 bg-success hover:bg-success">
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Run test
          </Button>
          {testResult && (
            <div className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm ${testResult.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <XCircle className="mt-0.5 h-4 w-4" />}
              <span>{testResult.msg}</span>
            </div>
          )}
        </Card>
      </TabsContent>

      {/* === Tab 2: Webhooks === */}
      <TabsContent value="webhooks" className="mt-6 space-y-6">
        <Card className="rounded-2xl p-6 shadow-lg shadow/50">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-success/10 p-2 text-success"><ScanLine className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold">HOWBODY Integration URLs</h2>
              <p className="text-sm text-muted-foreground">
                Provide these URLs to the HOWBODY device vendor. <strong>Member URLs</strong> open a page on the
                member's phone; only the <strong>Inbound Webhooks</strong> receive data from the scanner.
              </p>
            </div>
          </div>

          {/* Vendor constraint callout */}
          <div className="mt-5 flex items-start gap-3 rounded-xl bg-warning/10 p-3 text-sm text-warning ring-1 ring-warning/25">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-semibold">Vendor URL rules</p>
              <p className="mt-0.5 text-xs">
                The <span className="font-mono">Send-to-Phone</span> URL is <strong>fully static</strong> — HOWBODY does not append parameters.
                Reports auto-deliver to WhatsApp + Email the moment the scanner pushes data, so this URL is for re-viewing only.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {webhookUrls.map((u) => (
              <div key={u.key}>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">{u.label}</Label>
                  <Badge variant="outline" className={u.tagCls}>{u.tag}</Badge>
                </div>
                <div className="mt-1 flex gap-2">
                  <Input readOnly value={u.value} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(u.value)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{u.hint}</p>
              </div>
            ))}
          </div>
        </Card>
      </TabsContent>

      {/* === Tab 3: Devices === */}
      <TabsContent value="devices" className="mt-6">
        <HowbodyDevicesCard />
      </TabsContent>
    </Tabs>
  );
}
