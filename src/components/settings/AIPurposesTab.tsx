// AI Purposes tab — SSOT editor for ai_purposes. Shows resolved provider per purpose,
// per-provider model picker, smart temperature/max_tokens defaults, and a "Test"
// button that pings the active provider via ai-test-purpose.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Pencil, FlaskConical, Info, Zap, RotateCcw, AlertTriangle, Sparkles, Leaf } from "lucide-react";
import { PROVIDER_DEFAULTS, PURPOSE_DEFAULTS, normalizeModelForProvider, isCheapModel, cheapestModelFor } from "@/lib/ai/providerCatalog";

interface PurposeRow {
  id: string;
  branch_id: string | null;
  purpose: string;
  enabled: boolean;
  model: string | null;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  description: string | null;
  updated_at: string;
}

interface ProviderRow {
  scope: string;
  provider: string;
  default_model: string;
  is_active: boolean;
  is_default: boolean;
}

const PURPOSE_LABELS: Record<string, { title: string; desc: string }> = {
  whatsapp_reply: { title: "WhatsApp / Meta Replies", desc: "Conversational AI brain for WhatsApp, Instagram, Messenger" },
  lead_nurture: { title: "Lead Nurture Nudges", desc: "Re-engagement messages for cold leads" },
  lead_score: { title: "Lead Scoring", desc: "0-100 score + reasoning + next action" },
  campaign_draft: { title: "Campaign Drafter", desc: "WhatsApp/SMS/Email marketing copy" },
  template_generate: { title: "Template Generator", desc: "WhatsApp Cloud API approved templates" },
  dashboard_insight: { title: "Dashboard Insights", desc: "Business analyst summaries" },
  fitness_plan: { title: "Fitness Plan Generator", desc: "Personalized workout & nutrition plans" },
  review_reply: { title: "Google Review Replies", desc: "Public review classification + drafts" },
  automation_rule: { title: "Automation Rules", desc: "AI-tone for birthday wishes & rule-driven sends" },
};

// Mirrors SCOPE_MAP in supabase/functions/_shared/ai-runtime.ts
const PURPOSE_TO_SCOPE: Record<string, string> = {
  whatsapp_reply: "whatsapp_ai",
  lead_nurture: "lead_nurture",
  lead_score: "lead_scoring",
  campaign_draft: "all",
  template_generate: "all",
  dashboard_insight: "dashboard_insights",
  fitness_plan: "fitness_plans",
  review_reply: "all",
  automation_rule: "all",
};

function resolveProvider(scope: string, providers: ProviderRow[]): ProviderRow | null {
  const scoped = providers.find(p => p.scope === scope && p.is_active && p.is_default);
  if (scoped) return scoped;
  const all = providers.find(p => p.scope === "all" && p.is_active && p.is_default);
  if (all) return all;
  return { scope: "all", provider: "lovable", default_model: PROVIDER_DEFAULTS.lovable.default_model, is_active: true, is_default: true };
}

export function AIPurposesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PurposeRow | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const { data: purposes = [], isLoading } = useQuery({
    queryKey: ["ai_purposes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_purposes")
        .select("*")
        .is("branch_id", null)
        .order("purpose");
      if (error) throw error;
      return (data as PurposeRow[]) ?? [];
    },
  });

  const { data: providers = [] } = useQuery({
    queryKey: ["ai_provider_configs_active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("ai_provider_configs")
        .select("scope, provider, default_model, is_active, is_default")
        .eq("is_active", true);
      return (data as ProviderRow[]) ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async (row: Partial<PurposeRow> & { id: string }) => {
      const { error } = await supabase
        .from("ai_purposes")
        .update({
          enabled: row.enabled,
          model: row.model || null,
          system_prompt: row.system_prompt ?? "",
          temperature: row.temperature,
          max_tokens: row.max_tokens,
          description: row.description ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("AI purpose updated");
      qc.invalidateQueries({ queryKey: ["ai_purposes"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleTest = async (purpose: string) => {
    setTesting(purpose);
    try {
      const { data, error } = await supabase.functions.invoke("ai-test-purpose", {
        body: { purpose },
      });
      if (error) throw error;
      if (data?.success) {
        const label = `${data.provider} · ${data.model} · ${data.latency_ms}ms`;
        if (data.fallback_used) {
          toast.warning(`${label} (fallback to Lovable)`, {
            description: "Primary provider failed — check Call Logs for the underlying error and fix the model override.",
          });
        } else {
          toast.success(label, { description: data.sample?.slice(0, 120) || undefined });
        }
      } else {
        toast.error(data?.error || "Test failed");
      }
    } catch (e: any) {
      toast.error(e.message || "Test failed");
    } finally {
      setTesting(null);
    }
  };

  const editingScope = editing ? (PURPOSE_TO_SCOPE[editing.purpose] ?? "all") : "all";
  const editingResolved = useMemo(
    () => editing ? resolveProvider(editingScope, providers) : null,
    [editing, providers, editingScope],
  );
  const editingPresets = editingResolved ? PROVIDER_DEFAULTS[editingResolved.provider] : null;
  const editingPurposeDefaults = editing ? PURPOSE_DEFAULTS[editing.purpose] : null;
  const effectiveModelForEditor = editing && editingResolved
    ? normalizeModelForProvider(editingResolved.provider, editing.model || editingResolved.default_model)
    : "";

  // Auto-prefill recommended temperature/max_tokens when opening a purpose
  // that still has nulls (defensive — DB backfill should already have filled).
  useEffect(() => {
    if (!editing || !editingPurposeDefaults) return;
    if (editing.temperature == null || editing.max_tokens == null) {
      setEditing({
        ...editing,
        temperature: editing.temperature ?? editingPurposeDefaults.temperature,
        max_tokens: editing.max_tokens ?? editingPurposeDefaults.max_tokens,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50/60 border border-indigo-100">
        <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-600">
          Single source of truth for every AI feature. The <b>provider</b> (Google, OpenRouter, Lovable, etc.) is
          chosen per scope in the <b>Providers</b> tab; this screen controls the prompt, model override, temperature,
          and tokens for each purpose. Changes apply instantly — no redeploy.
        </p>
      </div>
      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {purposes.map((p) => {
        const meta = PURPOSE_LABELS[p.purpose] ?? { title: p.purpose, desc: "" };
        const scope = PURPOSE_TO_SCOPE[p.purpose] ?? "all";
        const resolved = resolveProvider(scope, providers);
        const rawModel = p.model || resolved?.default_model || "—";
        const effectiveModel = resolved ? normalizeModelForProvider(resolved.provider, rawModel) : rawModel;
        const overridden = !!p.model;
        const defaults = PURPOSE_DEFAULTS[p.purpose];
        return (
          <Card key={p.id} className="rounded-2xl shadow-lg shadow-slate-200/50 p-5 hover:shadow-xl hover:shadow-indigo-500/10 transition-all">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold text-slate-900">{meta.title}</h3>
                  {p.enabled ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Enabled</Badge>
                  ) : (
                    <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">Disabled</Badge>
                  )}
                  <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 gap-1">
                    <Zap className="h-3 w-3" />
                    {resolved?.provider ?? "lovable"}
                  </Badge>
                  <Badge variant="outline" className="text-xs font-mono">{effectiveModel}</Badge>
                  {overridden && (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">override</Badge>
                  )}
                  <Badge variant="outline" className="text-xs">scope: {scope}</Badge>
                </div>
                <p className="text-xs text-slate-500 mb-2">{meta.desc}</p>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600">
                    temp {p.temperature ?? defaults?.temperature ?? "—"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600">
                    max {p.max_tokens ?? defaults?.max_tokens ?? "—"} tok
                  </Badge>
                  {defaults && (
                    <span className="text-[10px] text-slate-400">{defaults.hint}</span>
                  )}
                </div>
                <p className="text-xs text-slate-600 line-clamp-2 font-mono bg-slate-50 p-2 rounded">
                  {p.system_prompt?.slice(0, 220) || "(no system prompt set)"}
                </p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTest(p.purpose)}
                  disabled={testing === p.purpose}
                  className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                >
                  <FlaskConical className="h-3.5 w-3.5 mr-1" />
                  {testing === p.purpose ? "Testing…" : "Test"}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit {editing && (PURPOSE_LABELS[editing.purpose]?.title ?? editing.purpose)}</SheetTitle>
          </SheetHeader>
          {editing && (
            <div className="space-y-4 mt-6">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-100">
                <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-900">
                  Provider for this purpose is <b>{editingResolved?.provider ?? "lovable"}</b> (scope:
                  {" "}<code className="font-mono">{editingScope}</code>). Change the provider in
                  the <b>Providers</b> tab. Pick a model below from the active provider's catalog,
                  or leave on default.
                </p>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <Label htmlFor="enabled" className="text-sm font-medium">Enabled</Label>
                <Switch
                  id="enabled"
                  checked={editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Model ({editingResolved?.provider})
                </Label>
                <Select
                  value={editing.model ?? "__default__"}
                  onValueChange={(v) =>
                    setEditing({ ...editing, model: v === "__default__" ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">
                      Use provider default ({editingResolved?.default_model})
                    </SelectItem>
                    {(editingPresets?.models ?? []).map((m) => (
                      <SelectItem key={m} value={m} className="font-mono text-xs">
                        {m}
                      </SelectItem>
                    ))}
                    {editing.model && !(editingPresets?.models ?? []).includes(editing.model) && (
                      <SelectItem value={editing.model} className="font-mono text-xs">
                        {editing.model} (custom)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-slate-500">
                  Will send to provider as: <code className="font-mono text-slate-700">{effectiveModelForEditor}</code>
                  {effectiveModelForEditor !== (editing.model || editingResolved?.default_model) && (
                    <span className="ml-1 inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3" /> auto-normalized
                    </span>
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prompt" className="text-xs font-semibold uppercase tracking-wider text-slate-500">System Prompt</Label>
                <Textarea
                  id="prompt"
                  rows={12}
                  value={editing.system_prompt ?? ""}
                  className="font-mono text-xs"
                  onChange={(e) => setEditing({ ...editing, system_prompt: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Temperature {editingPurposeDefaults && <span className="text-slate-400 normal-case font-normal">(rec. {editingPurposeDefaults.temperature})</span>}
                  </Label>
                  <Input
                    type="number" step="0.1" min="0" max="2"
                    value={editing.temperature ?? ""}
                    onChange={(e) => setEditing({ ...editing, temperature: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Max Tokens {editingPurposeDefaults && <span className="text-slate-400 normal-case font-normal">(rec. {editingPurposeDefaults.max_tokens})</span>}
                  </Label>
                  <Input
                    type="number" min="1"
                    value={editing.max_tokens ?? ""}
                    onChange={(e) => setEditing({ ...editing, max_tokens: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              </div>

              {editingPurposeDefaults && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-600 hover:text-indigo-700 hover:bg-indigo-50"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      model: null,
                      temperature: editingPurposeDefaults.temperature,
                      max_tokens: editingPurposeDefaults.max_tokens,
                    })
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Reset to recommended defaults
                </Button>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  onClick={() => saveMut.mutate(editing)}
                  disabled={saveMut.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {saveMut.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
