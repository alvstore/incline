import { useMemo, useState } from "react";
import { useBranchContext } from "@/contexts/BranchContext";
import {
  useIgCampaigns,
  useToggleIgCampaign,
  useDeleteIgCampaign,
  useIgRunsTrend,
  useIgApprovalsCount,
} from "@/services/igAutomationService";
import type { IgCommentCampaign } from "@/types/igAutomations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Instagram, MessageSquare, Users, AlertTriangle, Pencil, Trash2,
  ListChecks, TrendingUp, Reply, Sparkles, Activity, Zap, ShieldAlert,
} from "lucide-react";
import { IgCampaignDrawer } from "@/components/ig-automations/IgCampaignDrawer";
import { IgRunsLogDrawer } from "@/components/ig-automations/IgRunsLogDrawer";
import { IgApprovalQueueDrawer } from "@/components/ig-automations/IgApprovalQueueDrawer";
import { toast } from "sonner";
import { format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export function IgAutomationsPanel() {
  const { selectedBranch, branches } = useBranchContext();
  const branchId = selectedBranch && selectedBranch !== "all" ? selectedBranch : branches[0]?.id ?? null;
  const { data: campaigns = [], isLoading } = useIgCampaigns(branchId);
  const { data: approvalsCount = 0 } = useIgApprovalsCount(branchId);
  const toggle = useToggleIgCampaign();
  const del = useDeleteIgCampaign();

  const [editing, setEditing] = useState<IgCommentCampaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [logsFor, setLogsFor] = useState<IgCommentCampaign | null>(null);
  const [deleting, setDeleting] = useState<IgCommentCampaign | null>(null);
  const [approvalsFor, setApprovalsFor] = useState<{ open: boolean; campaign: IgCommentCampaign | null }>({ open: false, campaign: null });

  const stats = useMemo(() => {
    return campaigns.reduce(
      (a, c) => ({
        active: a.active + (c.is_active ? 1 : 0),
        comments: a.comments + (c.comments_matched ?? 0),
        dms: a.dms + (c.dms_sent ?? 0),
        failed: a.failed + (c.dms_failed ?? 0),
        leads: a.leads + (c.leads_created ?? 0),
        public: a.public + (c.public_replies_sent ?? 0),
      }),
      { active: 0, comments: 0, dms: 0, failed: 0, leads: 0, public: 0 },
    );
  }, [campaigns]);

  const successRate = stats.comments > 0
    ? Math.round((stats.dms / stats.comments) * 100)
    : 0;

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync({ id: deleting.id, branch_id: deleting.branch_id });
      toast.success("Campaign deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* HERO — Real-Time Operations band */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 shadow-xl shadow-indigo-500/20">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-12 -left-6 h-40 w-40 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4 text-white">
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur-sm ring-1 ring-white/20">
              <Instagram className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">Instagram Comment-to-DM</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-medium text-emerald-100 ring-1 ring-emerald-300/40">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  </span>
                  Live
                </span>
              </div>
              <p className="mt-1 max-w-xl text-sm text-indigo-100/90">
                Auto-DM users who comment trigger keywords on your Instagram posts. Set keywords, pick a post, and watch leads flow in.
              </p>
            </div>
          </div>
          <Button
            onClick={() => setCreating(true)}
            disabled={!branchId}
            className="h-11 min-w-[160px] rounded-xl bg-white text-indigo-700 shadow-lg shadow-indigo-900/20 transition-all duration-200 hover:bg-indigo-50 hover:shadow-xl focus:ring-2 focus:ring-white/60"
          >
            <Plus className="mr-1.5 h-4 w-4" /> New Campaign
          </Button>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <HeroStat label="Active" value={stats.active} icon={<Zap className="h-3.5 w-3.5" />} />
          <HeroStat label="Comments matched" value={stats.comments} icon={<MessageSquare className="h-3.5 w-3.5" />} />
          <HeroStat label="DMs sent" value={stats.dms} icon={<Reply className="h-3.5 w-3.5" />} />
          <HeroStat label="Leads created" value={stats.leads} icon={<Users className="h-3.5 w-3.5" />} accent />
          <HeroStat label="Success rate" value={`${successRate}%`} icon={<Sparkles className="h-3.5 w-3.5" />} />
        </div>
      </div>

      {approvalsCount > 0 && (
        <button
          type="button"
          onClick={() => setApprovalsFor({ open: true, campaign: null })}
          className="group flex w-full items-center gap-4 rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 p-4 text-left shadow-sm shadow-amber-200/40 transition-all duration-200 hover:shadow-md hover:shadow-amber-300/30 focus:outline-none focus:ring-2 focus:ring-amber-400"
          aria-label="Open approval queue"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/30">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-amber-900">
                {approvalsCount} DM{approvalsCount === 1 ? "" : "s"} awaiting your review
              </span>
              <Badge className="rounded-full border-0 bg-amber-200 text-amber-800">Action required</Badge>
            </div>
            <p className="mt-0.5 text-xs text-amber-700/80">
              Human-review campaigns are holding these messages. Approve, edit, or reject to release.
            </p>
          </div>
          <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 transition-colors group-hover:bg-amber-100">
            Open queue →
          </span>
        </button>
      )}

      {/* Secondary metric row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <MetricTile
          label="Public replies"
          value={stats.public}
          hint="Comment thread replies"
          icon={<Reply className="h-4 w-4" />}
          tone="indigo"
        />
        <MetricTile
          label="Failed DMs"
          value={stats.failed}
          hint={stats.failed > 0 ? "Needs attention" : "All clear"}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={stats.failed > 0 ? "red" : "emerald"}
        />
        <MetricTile
          label="Campaigns"
          value={campaigns.length}
          hint={`${stats.active} running`}
          icon={<Activity className="h-4 w-4" />}
          tone="violet"
        />
      </div>

      <IgTrendCard branchId={branchId} />

      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-slate-900">Campaigns</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">Toggle, edit, or inspect runs</p>
          </div>
          {campaigns.length > 0 && (
            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-600">
              {campaigns.length} total
            </Badge>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
                <Instagram className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-900">No campaigns yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Create your first auto-DM campaign in under a minute.
              </p>
              <Button
                onClick={() => setCreating(true)}
                disabled={!branchId}
                className="mt-5 h-10 rounded-xl bg-indigo-600 px-5 text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
              >
                <Plus className="mr-1.5 h-4 w-4" /> Create campaign
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-100">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Name</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Keywords</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Scope</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mode</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">DMs</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Leads</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Last triggered</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer transition-colors duration-150 hover:bg-indigo-50/40"
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${c.is_active ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-slate-300"}`} />
                          <span className="font-semibold text-slate-900">{c.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.keywords.slice(0, 3).map((k) => (
                            <Badge
                              key={k}
                              className="rounded-full border-0 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              {k}
                            </Badge>
                          ))}
                          {c.keywords.length > 3 && (
                            <Badge variant="outline" className="rounded-full border-slate-200 px-2 py-0.5 text-[11px] text-slate-500">
                              +{c.keywords.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {c.ig_media_id ? (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">
                            {c.ig_media_id.slice(0, 10)}…
                          </span>
                        ) : (
                          <span className="text-slate-400">All posts</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium capitalize text-violet-700">
                          {c.reply_mode}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{c.dms_sent}</TableCell>
                      <TableCell className="text-right font-semibold text-slate-900 tabular-nums">{c.leads_created}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {c.last_triggered_at ? format(new Date(c.last_triggered_at), "dd MMM, HH:mm") : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={c.is_active}
                          onCheckedChange={(v) => toggle.mutate({ id: c.id, is_active: v })}
                          aria-label={`Toggle campaign ${c.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          {c.human_review && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-lg px-2 text-xs text-amber-700 hover:bg-amber-50"
                              onClick={() => setApprovalsFor({ open: true, campaign: c })}
                              aria-label={`Review pending DMs for ${c.name}`}
                            >
                              <ShieldAlert className="h-4 w-4 mr-1" /> Review
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0 hover:bg-indigo-50 hover:text-indigo-600"
                            onClick={() => setLogsFor(c)}
                            aria-label={`View logs for ${c.name}`}
                          >
                            <ListChecks className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0 hover:bg-indigo-50 hover:text-indigo-600"
                            onClick={() => setEditing(c)}
                            aria-label={`Edit ${c.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0 hover:bg-red-50 hover:text-red-600"
                            onClick={() => setDeleting(c)}
                            aria-label={`Delete ${c.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <IgCampaignDrawer
        open={creating || !!editing}
        onOpenChange={(v) => { if (!v) { setCreating(false); setEditing(null); } }}
        campaign={editing}
        branchId={branchId}
      />
      <IgRunsLogDrawer
        open={!!logsFor}
        onOpenChange={(v) => { if (!v) setLogsFor(null); }}
        campaign={logsFor}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" and its full run history will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HeroStat({
  label, value, icon, accent,
}: { label: string; value: number | string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 backdrop-blur-sm ring-1 transition-colors ${
      accent
        ? "bg-white/20 ring-white/30"
        : "bg-white/10 ring-white/15 hover:bg-white/15"
    }`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-100/80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-white">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function MetricTile({
  label, value, hint, icon, tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone: "indigo" | "emerald" | "violet" | "red" | "amber";
}) {
  const toneMap = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
  } as const;
  return (
    <Card className="group rounded-2xl border-0 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-xl p-2.5 ${toneMap[tone]} transition-transform duration-200 group-hover:scale-110`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{value.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">{hint}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function IgTrendCard({ branchId }: { branchId: string | null }) {
  const { data = [], isLoading } = useIgRunsTrend(branchId, 14);
  const totals = data.reduce(
    (a, d) => ({ sent: a.sent + d.sent, failed: a.failed + d.failed, matched: a.matched + d.matched }),
    { sent: 0, failed: 0, matched: 0 },
  );
  return (
    <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
            <div className="rounded-lg bg-indigo-50 p-1.5">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
            </div>
            Activity
          </CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Last 14 days</p>
        </div>
        <div className="flex gap-3 text-xs">
          <LegendChip color="bg-indigo-500" label="Matched" value={totals.matched} />
          <LegendChip color="bg-emerald-500" label="Sent" value={totals.sent} />
          <LegendChip color="bg-red-500" label="Failed" value={totals.failed} />
        </div>
      </CardHeader>
      <CardContent className="h-56 pt-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-full w-full rounded-xl" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="igSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="igMatched" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "dd MMM")} fontSize={11} stroke="#94a3b8" />
              <YAxis allowDecimals={false} fontSize={11} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }}
                labelFormatter={(d) => format(new Date(d as string), "dd MMM yyyy")}
              />
              <Area type="monotone" dataKey="matched" stroke="#6366f1" strokeWidth={2} fill="url(#igMatched)" name="Matched" />
              <Area type="monotone" dataKey="sent" stroke="#10b981" strokeWidth={2} fill="url(#igSent)" name="DMs sent" />
              <Area type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} fillOpacity={0} name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function LegendChip({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 ring-1 ring-slate-100">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900 tabular-nums">{value}</span>
    </span>
  );
}
