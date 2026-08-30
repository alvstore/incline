import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Megaphone, Plus, MessageSquare, Mail, CheckCircle2, Clock, AlertTriangle,
  Loader2, MoreVertical, Pencil, Trash2, Copy, CalendarX, Search, BarChart3,
  RotateCw,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  listCampaigns, deleteCampaign, duplicateCampaign, cancelScheduledCampaign,
  retryFailedCampaign,
  type Campaign,
} from '@/services/campaignService';
import { CampaignWizard } from '@/components/campaigns/CampaignWizard';
import { CampaignDetailDrawer } from '@/components/campaigns/CampaignDetailDrawer';
import { CampaignReportDrawer } from '@/components/campaigns/CampaignReportDrawer';
import { CampaignFailureBreakdown } from '@/components/campaigns/CampaignFailureBreakdown';
import { format, formatDistanceToNow } from 'date-fns';

const channelIcon = (c: string) => (c === 'email' ? Mail : MessageSquare);
const statusBadge = (s: string) => {
  switch (s) {
    case 'sent': return { c: 'bg-success/15 text-success border-success/25', icon: CheckCircle2, label: 'sent' };
    case 'sending': return { c: 'bg-info/15 text-info border-info/25', icon: Loader2, label: 'sending' };
    case 'scheduled': return { c: 'bg-warning/15 text-warning border-warning/25', icon: Clock, label: 'scheduled' };
    case 'pending_template_approval': return { c: 'bg-warning/15 text-warning border-warning/25', icon: Clock, label: 'awaiting Meta approval' };
    case 'failed': return { c: 'bg-destructive/15 text-destructive border-destructive/25', icon: AlertTriangle, label: 'failed' };
    default: return { c: 'bg-muted text-foreground border-border', icon: Clock, label: s };
  }
};

export function CampaignsPanel() {
  const qc = useQueryClient();
  const { selectedBranch } = useBranchContext();
  const branchId = selectedBranch && selectedBranch !== 'all' ? selectedBranch : null;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Campaign | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [announceClassId, setAnnounceClassId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link from the Classes page: /campaigns?announce_class=<id>
  useEffect(() => {
    const classId = searchParams.get('announce_class');
    if (!classId) return;
    setAnnounceClassId(classId);
    setWizardOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('announce_class');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', branchId],
    queryFn: () => listCampaigns(branchId!),
    enabled: !!branchId,
    // Poll fast while anything is actively sending so the card reflects
    // send-broadcast's live progress writes; slow poll otherwise.
    refetchInterval: (q) => {
      const rows = (q.state.data || []) as Campaign[];
      return rows.some((c) => c.status === 'sending') ? 3000 : 30000;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['campaigns', branchId] });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => { toast.success('Campaign deleted'); setConfirmDelete(null); refresh(); },
    onError: (e: any) => toast.error(e?.message || 'Delete failed'),
  });
  const dupMut = useMutation({
    mutationFn: (id: string) => duplicateCampaign(id),
    onSuccess: (c) => { toast.success('Duplicated as draft'); refresh(); setEditingCampaign(c); setWizardOpen(true); },
    onError: (e: any) => toast.error(e?.message || 'Duplicate failed'),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelScheduledCampaign(id),
    onSuccess: () => { toast.success('Schedule cancelled — moved to draft'); refresh(); },
    onError: (e: any) => toast.error(e?.message || 'Cancel failed'),
  });
  const retryMut = useMutation({
    mutationFn: (id: string) => retryFailedCampaign(id),
    onSuccess: () => { toast.success('Campaign requeued — will send within 1 minute'); refresh(); },
    onError: (e: any) => toast.error(e?.message || 'Retry failed'),
  });

  const openCreate = () => { setEditingCampaign(null); setWizardOpen(true); };
  const openEdit = (c: Campaign) => { setEditingCampaign(c); setWizardOpen(true); };

  const filteredCampaigns = useMemo(() => {
    let out = campaigns as Campaign[];
    if (statusFilter !== 'all') out = out.filter((c) => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((c) => c.name.toLowerCase().includes(q) || (c.message || '').toLowerCase().includes(q));
    }
    return out;
  }, [campaigns, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Marketing & Campaigns</h2>
          <p className="text-sm text-muted-foreground">Promotional events, offers, images and PDFs to members, leads and contacts. For quick one-shot announcements use the <strong>New Announcement</strong> button above.</p>
        </div>
        <Button
          onClick={openCreate}
          className="rounded-xl bg-primary hover:bg-primary text-primary-foreground gap-2"
          disabled={!branchId}
        >
          <Plus className="h-4 w-4" /> New Campaign
        </Button>
      </div>

      {!branchId && (
        <div className="rounded-2xl bg-warning/10 border border-warning/25 p-4 text-warning text-sm">
          Select a specific branch from the top-bar selector to view and create campaigns.
        </div>
      )}

      {branchId && campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="rounded-xl pl-8 h-9" placeholder="Search campaigns" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="h-9 rounded-xl border bg-card px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_template_approval">Awaiting Meta approval</option>
            <option value="scheduled">Scheduled</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      )}

      {branchId && isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : branchId && filteredCampaigns.length === 0 ? (
        <div className="rounded-2xl bg-card border border-dashed border-border p-12 text-center">
          <Megaphone className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold text-foreground">{campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match your filters'}</h3>
          <p className="text-sm text-muted-foreground mt-1">{campaigns.length === 0 ? 'Create your first marketing campaign to engage with members.' : 'Try a different search or status.'}</p>
        </div>
      ) : branchId && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCampaigns.map((c: Campaign) => {
            const Icon = channelIcon(c.channel);
            const sb = statusBadge(c.status);
            const Sicon = sb.icon;
            const isScheduled = c.status === 'scheduled' && c.scheduled_at;
            const editable = c.status === 'draft' || c.status === 'scheduled' || c.status === 'pending_template_approval' || c.status === 'failed';
            const inFlight = c.status === 'sending';
            const isFailed = c.status === 'failed';
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => setDetailCampaign(c)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailCampaign(c); }} className="rounded-2xl bg-card p-5 shadow-md shadow/50 hover:shadow-lg hover:ring-1 hover:ring-primary/25 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary relative">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-primary/15 dark:bg-primary/20 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground line-clamp-1">{c.name}</h3>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{c.channel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={`${sb.c} rounded-full text-[10px] uppercase`}>
                      <Sicon className={`h-3 w-3 mr-1 ${c.status === 'sending' ? 'animate-spin' : ''}`} /> {sb.label}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" aria-label="Campaign actions">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => setDetailCampaign(c)}>
                          <CheckCircle2 className="h-4 w-4 mr-2" /> View details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setReportCampaign(c)}>
                          <BarChart3 className="h-4 w-4 mr-2" /> View report
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!editable || inFlight} onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => dupMut.mutate(c.id)} disabled={dupMut.isPending}>
                          <Copy className="h-4 w-4 mr-2" /> Duplicate
                        </DropdownMenuItem>
                        {c.status === 'scheduled' && (
                          <DropdownMenuItem onClick={() => cancelMut.mutate(c.id)} disabled={cancelMut.isPending}>
                            <CalendarX className="h-4 w-4 mr-2" /> Cancel schedule
                          </DropdownMenuItem>
                        )}
                        {isFailed && (
                          <DropdownMenuItem onClick={() => retryMut.mutate(c.id)} disabled={retryMut.isPending}>
                            <RotateCw className="h-4 w-4 mr-2" /> Retry now
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          disabled={inFlight}
                          onClick={() => setConfirmDelete(c)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{c.message}</p>
                {isFailed && c.last_run_error && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/25 px-2.5 py-2 mb-3 text-xs text-destructive flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold uppercase tracking-wider text-[10px]">Last failure</p>
                      <p className="line-clamp-2 break-words">{c.last_run_error}</p>
                    </div>
                  </div>
                )}
                {isScheduled && (
                  <div className="rounded-lg bg-warning/10 border border-warning/25 px-2.5 py-1.5 mb-3 text-xs text-warning flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Sends {formatDistanceToNow(new Date(c.scheduled_at!), { addSuffix: true })}
                  </div>
                )}
                {inFlight && c.recipients_count > 0 && (() => {
                  const done = (c.success_count || 0) + (c.failure_count || 0);
                  const pct = Math.min(100, Math.round((done / Math.max(1, c.recipients_count)) * 100));
                  return (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        <span>Sending in background</span>
                        <span>{done}/{c.recipients_count} · {pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })()}
                {(c.failure_count || 0) > 0 && (
                  <CampaignFailureBreakdown campaignId={c.id} active={inFlight} />
                )}
                <div className="grid grid-cols-5 gap-2 text-center pt-3 border-t">
                  <div>
                    <p className="text-lg font-bold text-foreground">{c.recipients_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Total</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-info">{c.success_count ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Sent</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-success">{c.delivered_count ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Delivered</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-primary">{c.read_count ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Read</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-destructive">{c.failure_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Failed</p>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground text-center mt-3">
                  {c.sent_at
                    ? `Sent ${format(new Date(c.sent_at), 'dd MMM, HH:mm')}`
                    : `Created ${format(new Date(c.created_at), 'dd MMM, HH:mm')}`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {branchId && (
        <CampaignWizard
          open={wizardOpen}
          onOpenChange={(o) => { setWizardOpen(o); if (!o) { setEditingCampaign(null); setAnnounceClassId(null); } }}
          branchId={branchId}
          editingCampaign={editingCampaign}
          prefillClassId={announceClassId}
        />
      )}
      <CampaignDetailDrawer open={!!detailCampaign} onOpenChange={(o) => !o && setDetailCampaign(null)} campaign={detailCampaign} />
      <CampaignReportDrawer open={!!reportCampaign} onOpenChange={(o) => !o && setReportCampaign(null)} campaign={reportCampaign} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{confirmDelete?.name}</strong> and all its delivery history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive hover:bg-destructive"
              onClick={() => confirmDelete && delMut.mutate(confirmDelete.id)}
              disabled={delMut.isPending}
            >
              {delMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
