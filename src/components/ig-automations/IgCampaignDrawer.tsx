import { useEffect, useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X, Sparkles, Eye, Loader2, Image as ImageIcon, PlayCircle, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import {
  useUpsertIgCampaign, useIgAccounts, useIgMedia, useTestIgCommentMatch,
  type IgMediaItem,
} from "@/services/igAutomationService";
import type { IgCommentCampaign, IgMatchType, IgReplyMode } from "@/types/igAutomations";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: IgCommentCampaign | null;
  branchId: string | null;
}

const DEFAULT_TEMPLATE =
  "Hey {{first_name}}! 👋 Thanks for commenting on our post. Here's the info you asked about…";

export function IgCampaignDrawer({ open, onOpenChange, campaign, branchId }: Props) {
  const upsert = useUpsertIgCampaign();
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState<Partial<IgCommentCampaign>>(() => initial(campaign));
  const [kwInput, setKwInput] = useState("");

  useEffect(() => { setForm(initial(campaign)); setTab("details"); setKwInput(""); }, [campaign, open]);

  const update = (patch: Partial<IgCommentCampaign>) => setForm((f) => ({ ...f, ...patch }));

  const addKeyword = () => {
    const v = kwInput.trim();
    if (!v) return;
    if (!(form.keywords || []).includes(v)) {
      update({ keywords: [...(form.keywords || []), v] });
    }
    setKwInput("");
  };

  const removeKeyword = (k: string) =>
    update({ keywords: (form.keywords || []).filter((x) => x !== k) });

  const preview = useMemo(() => {
    const tpl = form.dm_template || DEFAULT_TEMPLATE;
    return tpl
      .replace(/\{\{first_name\}\}/g, "Alex")
      .replace(/\{\{username\}\}/g, "@alex")
      .replace(/\{\{keyword\}\}/g, (form.keywords || [])[0] || "INCLINE")
      .replace(/\{\{campaign_name\}\}/g, form.name || "Sample Campaign")
      .replace(/\{\{post_link\}\}/g, "https://instagram.com/p/sample");
  }, [form.dm_template, form.keywords, form.name]);

  const canSave =
    !!branchId && (form.name?.trim().length ?? 0) > 0 && (form.keywords?.length ?? 0) > 0 &&
    ((form.reply_mode === "ai") || !!form.dm_template?.trim());

  const handleSave = async () => {
    if (!branchId) return;
    try {
      await upsert.mutateAsync({
        ...(campaign?.id ? { id: campaign.id } : {}),
        ...form,
        branch_id: branchId,
        name: form.name!,
        keywords: form.keywords || [],
      } as any);
      toast.success(campaign ? "Campaign updated" : "Campaign created");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>{campaign ? "Edit campaign" : "New comment-to-DM campaign"}</SheetTitle>
          <SheetDescription>
            Detect a keyword in Instagram comments and send a personalized DM automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid grid-cols-5 mx-6 mt-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="triggers">Triggers</TabsTrigger>
              <TabsTrigger value="reply">Reply</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
              <TabsTrigger value="review">Review</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="px-6 py-4 space-y-4">
              <Field label="Campaign name" required>
                <Input value={form.name || ""} onChange={(e) => update({ name: e.target.value })}
                  placeholder="e.g. INCLINE membership info" />
              </Field>
              <Field label="Instagram post / reel ID" hint="Leave blank to apply to ALL posts on this account.">
                <Input value={form.ig_media_id || ""} onChange={(e) => update({ ig_media_id: e.target.value || null })}
                  placeholder="17912345678901234" />
              </Field>
              <Field label="Instagram account ID" hint="Your business IG account that owns the post.">
                <Input value={form.ig_account_id || ""} onChange={(e) => update({ ig_account_id: e.target.value || null })}
                  placeholder="17841400000000000" />
              </Field>
            </TabsContent>

            <TabsContent value="triggers" className="px-6 py-4 space-y-4">
              <Field label="Trigger keywords" required hint="Press Enter to add. Anyone whose comment matches will be DM'd.">
                <div className="flex gap-2">
                  <Input value={kwInput} onChange={(e) => setKwInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                    placeholder="e.g. INCLINE, PRICE, TRIAL" />
                  <Button type="button" variant="secondary" onClick={addKeyword}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(form.keywords || []).map((k) => (
                    <Badge key={k} variant="secondary" className="rounded-full pr-1">
                      {k}
                      <button onClick={() => removeKeyword(k)} className="ml-1 rounded-full p-0.5 hover:bg-slate-200">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </Field>
              <Field label="Match type">
                <Select value={form.match_type || "contains"}
                  onValueChange={(v) => update({ match_type: v as IgMatchType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains keyword</SelectItem>
                    <SelectItem value="exact">Exact match</SelectItem>
                    <SelectItem value="starts_with">Starts with</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleRow label="Case-sensitive" hint="Off = recommended."
                checked={!!form.case_sensitive}
                onChange={(v) => update({ case_sensitive: v })}
              />
            </TabsContent>

            <TabsContent value="reply" className="px-6 py-4 space-y-4">
              <Field label="Reply mode">
                <Select value={form.reply_mode || "template"}
                  onValueChange={(v) => update({ reply_mode: v as IgReplyMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="template">Fixed template</SelectItem>
                    <SelectItem value="ai">AI-generated</SelectItem>
                    <SelectItem value="hybrid">Hybrid (AI with template fallback)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {(form.reply_mode !== "ai") && (
                <Field label="DM template" required={form.reply_mode === "template"}
                  hint="Variables: {{first_name}} {{username}} {{keyword}} {{campaign_name}} {{post_link}}">
                  <Textarea rows={5} value={form.dm_template || ""}
                    onChange={(e) => update({ dm_template: e.target.value })}
                    placeholder={DEFAULT_TEMPLATE} />
                </Field>
              )}

              {(form.reply_mode !== "template") && (
                <>
                  <Field label="AI instruction"
                    hint="What the AI should explain or ask. Reuses the same brain as WhatsApp.">
                    <Textarea rows={4} value={form.ai_instruction || ""}
                      onChange={(e) => update({ ai_instruction: e.target.value })}
                      placeholder="Explain membership options, ask for fitness goal, invite to book a visit." />
                  </Field>
                  <Field label="Tone">
                    <Select value={form.ai_tone || "friendly"}
                      onValueChange={(v) => update({ ai_tone: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="premium">Premium</SelectItem>
                        <SelectItem value="short">Short & punchy</SelectItem>
                        <SelectItem value="persuasive">Persuasive</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Fallback message" hint="Used if the AI fails.">
                    <Textarea rows={2} value={form.fallback_message || ""}
                      onChange={(e) => update({ fallback_message: e.target.value })} />
                  </Field>
                </>
              )}

              <Field label="Optional public comment reply"
                hint="Will also reply publicly under the comment.">
                <Input value={form.comment_public_reply || ""}
                  onChange={(e) => update({ comment_public_reply: e.target.value || null })}
                  placeholder="Sent you a DM! 📩" />
              </Field>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase mb-1 flex items-center gap-1">
                  <Eye className="h-3 w-3" /> DM Preview
                </div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">{preview}</div>
              </div>
            </TabsContent>

            <TabsContent value="actions" className="px-6 py-4 space-y-4">
              <Field label="Delay before sending (seconds)"
                hint="0 = immediate. Useful to look human (try 30–120).">
                <Input type="number" min={0} max={86400}
                  value={form.delay_seconds ?? 0}
                  onChange={(e) => update({ delay_seconds: Math.max(0, Number(e.target.value || 0)) })} />
              </Field>
              <Field label="Lead tag" hint="Tag applied to the created/updated lead.">
                <Input value={form.lead_tag || ""} onChange={(e) => update({ lead_tag: e.target.value || null })}
                  placeholder="instagram-comment-INCLINE" />
              </Field>
              <Field label="Pipeline stage">
                <Input value={form.pipeline_stage || ""} onChange={(e) => update({ pipeline_stage: e.target.value || null })}
                  placeholder="new" />
              </Field>
              <ToggleRow label="Notify staff on trigger" checked={form.notify_staff ?? true}
                onChange={(v) => update({ notify_staff: v })} />
              <ToggleRow label="Allow repeat DMs to same user"
                hint="Off = each user is DM'd only once per campaign."
                checked={!!form.allow_repeat}
                onChange={(v) => update({ allow_repeat: v })} />
              <ToggleRow label="Require human review before sending"
                hint="When on, DMs stay in 'pending' for staff to approve."
                checked={!!form.human_review}
                onChange={(v) => update({ human_review: v })} />
            </TabsContent>

            <TabsContent value="review" className="px-6 py-4 space-y-3">
              <div className="rounded-xl border bg-white p-4 space-y-2">
                <Row k="Name" v={form.name || "—"} />
                <Row k="Keywords" v={(form.keywords || []).join(", ") || "—"} />
                <Row k="Match" v={`${form.match_type || "contains"}${form.case_sensitive ? " (case-sensitive)" : ""}`} />
                <Row k="Scope" v={form.ig_media_id ? `Post ${form.ig_media_id}` : "All posts"} />
                <Row k="Reply mode" v={form.reply_mode || "template"} />
                <Row k="Delay" v={`${form.delay_seconds ?? 0}s`} />
                <Row k="Notify staff" v={form.notify_staff ? "Yes" : "No"} />
                <Row k="Allow repeat" v={form.allow_repeat ? "Yes" : "No"} />
              </div>
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <Sparkles className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                Instagram only allows DMing users within 7 days of their comment.
                The system honors this automatically.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active ?? true} onCheckedChange={(v) => update({ is_active: v })} />
            <span className="text-sm text-slate-700">{form.is_active ?? true ? "Active" : "Paused"}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || upsert.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {upsert.isPending ? "Saving…" : campaign ? "Save changes" : "Create campaign"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-900 font-medium text-right">{v}</span>
    </div>
  );
}

function initial(c: IgCommentCampaign | null): Partial<IgCommentCampaign> {
  return c ? { ...c } : {
    name: "",
    keywords: [],
    match_type: "contains",
    case_sensitive: false,
    reply_mode: "template",
    dm_template: DEFAULT_TEMPLATE,
    delay_seconds: 0,
    notify_staff: true,
    allow_repeat: false,
    human_review: false,
    is_active: true,
    ai_tone: "friendly",
  };
}
