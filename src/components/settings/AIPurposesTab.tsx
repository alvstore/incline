// AI Purposes tab — SSOT editor for ai_purposes (lifted from former /ai-control-center page).
import { useState } from "react";
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
import { toast } from "sonner";
import { Pencil } from "lucide-react";

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

export function AIPurposesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PurposeRow | null>(null);

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

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Single source of truth for every AI feature. Edit prompts and models live — no redeploy needed.
      </p>
      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {purposes.map((p) => {
        const meta = PURPOSE_LABELS[p.purpose] ?? { title: p.purpose, desc: "" };
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
                  <Badge variant="outline" className="text-xs">{p.model ?? "default model"}</Badge>
                </div>
                <p className="text-xs text-slate-500 mb-2">{meta.desc}</p>
                <p className="text-xs text-slate-600 line-clamp-2 font-mono bg-slate-50 p-2 rounded">
                  {p.system_prompt?.slice(0, 220) || "(no system prompt set)"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
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
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <Label htmlFor="enabled" className="text-sm font-medium">Enabled</Label>
                <Switch
                  id="enabled"
                  checked={editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="model" className="text-xs font-semibold uppercase tracking-wider text-slate-500">Model</Label>
                <Input
                  id="model"
                  value={editing.model ?? ""}
                  placeholder="google/gemini-3-flash-preview"
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                />
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
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Temperature</Label>
                  <Input
                    type="number" step="0.1" min="0" max="2"
                    value={editing.temperature ?? ""}
                    onChange={(e) => setEditing({ ...editing, temperature: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Max Tokens</Label>
                  <Input
                    type="number" min="1"
                    value={editing.max_tokens ?? ""}
                    onChange={(e) => setEditing({ ...editing, max_tokens: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              </div>
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
