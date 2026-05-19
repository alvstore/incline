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
import { Plus, Instagram, MessageSquare, Users, AlertTriangle, Pencil, Trash2, ListChecks, TrendingUp } from "lucide-react";
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
