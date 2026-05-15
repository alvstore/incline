import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Megaphone, Plus, MessageSquare, Mail, CheckCircle2, Clock, AlertTriangle,
  Loader2, MoreVertical, Pencil, Trash2, Copy, CalendarX, Search, BarChart3,
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
  type Campaign,
} from '@/services/campaignService';
import { CampaignWizard } from '@/components/campaigns/CampaignWizard';
import { CampaignDetailDrawer } from '@/components/campaigns/CampaignDetailDrawer';
import { CampaignReportDrawer } from '@/components/campaigns/CampaignReportDrawer';
import { format, formatDistanceToNow } from 'date-fns';

const channelIcon = (c: string) => (c === 'email' ? Mail : MessageSquare);
const statusBadge = (s: string) => {
  switch (s) {
    case 'sent': return { c: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 };
    case 'sending': return { c: 'bg-blue-100 text-blue-700 border-blue-200', icon: Loader2 };
    case 'scheduled': return { c: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock };
    case 'failed': return { c: 'bg-red-100 text-red-700 border-red-200', icon: AlertTriangle };
    default: return { c: 'bg-slate-100 text-slate-700 border-slate-200', icon: Clock };
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

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns', branchId],
    queryFn: () => listCampaigns(branchId!),
    enabled: !!branchId,
    refetchInterval: 30000,
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
          className="rounded-xl bg-violet-600 hover:bg-violet-700 text-white gap-2"
          disabled={!branchId}
        >
          <Plus className="h-4 w-4" /> New Campaign
        </Button>
      </div>

      {!branchId && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-800 text-sm">
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
            <option value="scheduled">Scheduled</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      )}

      {branchId && isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-violet-600" /></div>
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
            const editable = c.status === 'draft' || c.status === 'scheduled';
            const inFlight = c.status === 'sending';
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => setDetailCampaign(c)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailCampaign(c); }} className="rounded-2xl bg-card p-5 shadow-md shadow-slate-200/50 hover:shadow-lg hover:ring-1 hover:ring-violet-200 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500 relative">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-xl bg-violet-100 dark:bg-violet-500/20 text-violet-600 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground line-clamp-1">{c.name}</h3>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{c.channel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={`${sb.c} rounded-full text-[10px] uppercase`}>
                      <Sicon className={`h-3 w-3 mr-1 ${c.status === 'sending' ? 'animate-spin' : ''}`} /> {c.status}
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
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-700 focus:bg-red-50"
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
                {isScheduled && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 mb-3 text-xs text-amber-800 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Sends {formatDistanceToNow(new Date(c.scheduled_at!), { addSuffix: true })}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t">
                  <div>
                    <p className="text-lg font-bold text-foreground">{c.recipients_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Sent to</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{c.success_count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase">Delivered</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-red-600">{c.failure_count}</p>
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
          onOpenChange={(o) => { setWizardOpen(o); if (!o) setEditingCampaign(null); }}
          branchId={branchId}
          editingCampaign={editingCampaign}
        />
      )}
      <CampaignDetailDrawer open={!!detailCampaign} onOpenChange={(o) => !o && setDetailCampaign(null)} campaign={detailCampaign} />

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
              className="rounded-xl bg-red-600 hover:bg-red-700"
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
