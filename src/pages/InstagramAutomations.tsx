import { useMemo, useState } from "react";
import { useBranchContext } from "@/contexts/BranchContext";
import {
  useIgCampaigns,
  useToggleIgCampaign,
  useDeleteIgCampaign,
  useIgRunsTrend,
} from "@/services/igAutomationService";
import type { IgCommentCampaign } from "@/types/igAutomations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Instagram, MessageSquare, Users, AlertTriangle, Pencil, Trash2, ListChecks, TrendingUp, Reply } from "lucide-react";
import { IgCampaignDrawer } from "@/components/ig-automations/IgCampaignDrawer";
import { IgRunsLogDrawer } from "@/components/ig-automations/IgRunsLogDrawer";
import { toast } from "sonner";
import { format } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function InstagramAutomationsPage() {
  const { selectedBranch, branches } = useBranchContext();
  const branchId = selectedBranch && selectedBranch !== "all" ? selectedBranch : branches[0]?.id ?? null;
  const { data: campaigns = [], isLoading } = useIgCampaigns(branchId);
  const toggle = useToggleIgCampaign();
  const del = useDeleteIgCampaign();

  const [editing, setEditing] = useState<IgCommentCampaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [logsFor, setLogsFor] = useState<IgCommentCampaign | null>(null);

  const stats = useMemo(() => {
    const totals = campaigns.reduce(
      (a, c) => ({
        active: a.active + (c.is_active ? 1 : 0),
        comments: a.comments + c.comments_matched,
        dms: a.dms + c.dms_sent,
        failed: a.failed + c.dms_failed,
        leads: a.leads + c.leads_created,
      }),
      { active: 0, comments: 0, dms: 0, failed: 0, leads: 0 },
    );
    return totals;
  }, [campaigns]);

  const handleDelete = async (c: IgCommentCampaign) => {
    if (!confirm(`Delete "${c.name}"? Its run history will also be removed.`)) return;
    try {
      await del.mutateAsync({ id: c.id, branch_id: c.branch_id });
      toast.success("Campaign deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Instagram className="h-6 w-6 text-indigo-600" />
            Instagram Comment-to-DM Automations
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Auto-DM users who comment trigger keywords on your Instagram posts.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          disabled={!branchId}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4 mr-1" /> New Campaign
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Active" value={stats.active} icon={<Instagram className="h-4 w-4" />} tone="indigo" />
        <KpiCard label="Comments matched" value={stats.comments} icon={<MessageSquare className="h-4 w-4" />} tone="emerald" />
        <KpiCard label="DMs sent" value={stats.dms} icon={<MessageSquare className="h-4 w-4" />} tone="violet" />
        <KpiCard label="Failed" value={stats.failed} icon={<AlertTriangle className="h-4 w-4" />} tone="red" />
        <KpiCard label="Leads created" value={stats.leads} icon={<Users className="h-4 w-4" />} tone="amber" />
      </div>

      <IgTrendCard branchId={branchId} />

      <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
        <CardHeader>
          <CardTitle className="text-base">Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-slate-500 text-sm">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="py-12 text-center">
              <Instagram className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No campaigns yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Create one to auto-DM anyone who comments your keyword.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">DMs</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead>Last triggered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium text-slate-900">{c.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.keywords.slice(0, 3).map((k) => (
                          <Badge key={k} variant="secondary" className="rounded-full">{k}</Badge>
                        ))}
                        {c.keywords.length > 3 && (
                          <Badge variant="outline" className="rounded-full">+{c.keywords.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {c.ig_media_id ? `Post ${c.ig_media_id.slice(0, 10)}…` : "All posts"}
                    </TableCell>
                    <TableCell className="capitalize text-sm">{c.reply_mode}</TableCell>
                    <TableCell className="text-right">{c.dms_sent}</TableCell>
                    <TableCell className="text-right">{c.leads_created}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {c.last_triggered_at ? format(new Date(c.last_triggered_at), "dd MMM, HH:mm") : "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={c.is_active}
                        onCheckedChange={(v) => toggle.mutate({ id: c.id, is_active: v })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setLogsFor(c)} aria-label="View logs">
                          <ListChecks className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(c)} aria-label="Delete">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
    </div>
  );
}

function KpiCard({
  label, value, icon, tone,
}: { label: string; value: number; icon: React.ReactNode; tone: "indigo" | "emerald" | "violet" | "red" | "amber" }) {
  const toneMap = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
  } as const;
  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-full ${toneMap[tone]}`}>{icon}</div>
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">{label}</div>
          <div className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
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
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-600" /> Activity (last 14 days)
        </CardTitle>
        <div className="flex gap-4 text-xs">
          <span className="text-slate-500">Matched <b className="text-slate-900">{totals.matched}</b></span>
          <span className="text-emerald-600">Sent <b>{totals.sent}</b></span>
          <span className="text-red-500">Failed <b>{totals.failed}</b></span>
        </div>
      </CardHeader>
      <CardContent className="h-48 pt-0">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">Loading…</div>
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
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                labelFormatter={(d) => format(new Date(d as string), "dd MMM yyyy")}
              />
              <Area type="monotone" dataKey="matched" stroke="#6366f1" fill="url(#igMatched)" name="Matched" />
              <Area type="monotone" dataKey="sent" stroke="#10b981" fill="url(#igSent)" name="DMs sent" />
              <Area type="monotone" dataKey="failed" stroke="#ef4444" fillOpacity={0} name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
