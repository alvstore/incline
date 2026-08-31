import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveSheet,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
} from '@/components/ui/ResponsiveSheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Loader2, Download, AlertTriangle, CheckCircle2, Clock, MessageCircle,
  Search, FileText, Gauge,
} from 'lucide-react';
import { explainCommError, isPacingError } from '@/lib/comms/metaErrorLabels';
import { getCampaignReport, type Campaign, type CampaignRecipientRow } from '@/services/campaignService';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

function statusPill(status: string) {
  switch (status) {
    case 'sent': return { c: 'bg-success/15 text-success', icon: CheckCircle2, label: 'Sent' };
    case 'delivered': return { c: 'bg-success/15 text-success', icon: CheckCircle2, label: 'Delivered' };
    case 'read': return { c: 'bg-primary/15 text-primary', icon: MessageCircle, label: 'Read' };
    case 'submitted': return { c: 'bg-info/15 text-info', icon: CheckCircle2, label: 'Sent' };
    case 'failed': return { c: 'bg-destructive/15 text-destructive', icon: AlertTriangle, label: 'Failed' };
    case 'pace_limited': return { c: 'bg-warning/15 text-warning', icon: Gauge, label: 'Pace limited' };
    case 'queued': return { c: 'bg-muted text-foreground', icon: Clock, label: 'Queued' };
    case 'skipped': return { c: 'bg-warning/15 text-warning', icon: AlertTriangle, label: 'Skipped' };
    case 'suppressed': return { c: 'bg-warning/15 text-warning', icon: AlertTriangle, label: 'Suppressed' };
    default: return { c: 'bg-muted text-muted-foreground', icon: Clock, label: status };
  }
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, rows: CampaignRecipientRow[]) {
  const header = ['name', 'phone', 'email', 'source', 'status', 'in_window', 'error_code', 'error_reason', 'dispatched_at', 'read_at'];
  const lines = [
    header.join(','),
    ...rows.map((r) => [
      r.full_name, r.phone, r.email, r.source_label || r.source_type, r.status,
      r.in_window ? 'yes' : 'no', r.error_code, r.error_reason, r.dispatched_at, r.read_at,
    ].map(csvEscape).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}-report.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function CampaignReportDrawer({ open, onOpenChange, campaign }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['campaign-report', campaign?.id],
    queryFn: () => getCampaignReport(campaign!.id),
    enabled: !!campaign && open,
    refetchInterval: campaign?.status === 'sending' ? 3000 : false,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = data?.recipients || [];
  const groups = data?.groups || [];

  const filtered = useMemo(() => {
    let out = rows;
    if (filter === 'pace_limited') out = out.filter(isPaced);
    else if (filter === 'failed') out = out.filter((r) => r.status === 'failed' && !isPaced(r));
    else if (filter !== 'all') out = out.filter((r) => r.status === filter);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        (r.full_name || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(q) ||
        (r.email || '').toLowerCase().includes(q));
    }
    return out;
  }, [rows, filter, search]);

  const isPaced = (r: CampaignRecipientRow) =>
    r.status === 'pace_limited' ||
    (r.status === 'failed' && isPacingError(`${r.error_code ?? ''} ${r.error_reason ?? ''}`));

  const totals = useMemo(() => {
    const t = { total: rows.length, sent: 0, failed: 0, pace_limited: 0, queued: 0, read: 0 };
    for (const r of rows) {
      if (['sent', 'submitted', 'delivered', 'read'].includes(r.status)) t.sent++;
      else if (isPaced(r)) t.pace_limited++;
      else if (r.status === 'failed') t.failed++;
      else if (r.status === 'queued') t.queued++;
      if (r.read_at || r.status === 'read') t.read++;
    }
    return t;
  }, [rows]);

  if (!campaign) return null;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetHeader>
        <ResponsiveSheetTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" /> Campaign report
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>{campaign.name}</ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <div className="px-1 pb-2 space-y-4">
        {/* Totals */}
        <div className={`grid ${totals.pace_limited > 0 ? 'grid-cols-5' : 'grid-cols-4'} gap-2`}>
          <Stat label="Total" value={totals.total} color="text-foreground" />
          <Stat label="Delivered" value={totals.sent} color="text-success" />
          <Stat label="Failed" value={totals.failed} color="text-destructive" />
          {totals.pace_limited > 0 && (
            <Stat label="Pace limited" value={totals.pace_limited} color="text-warning" icon={Gauge} />
          )}
          <Stat label="Read" value={totals.read} color="text-primary" icon={MessageCircle} />
        </div>

        {totals.pace_limited > 0 && (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-warning flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" /> {totals.pace_limited} pace limited
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/80">
              Meta withheld these marketing messages to protect recipient experience (codes 131049 /
              130472). They are not delivery failures, are never auto-retried, and become eligible
              again once the per-recipient cooldown expires.
            </p>
          </div>
        )}

        {/* Failure groups */}
        {groups.length > 0 && (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/10 dark:bg-destructive/5 p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Failure breakdown
            </p>
            <ul className="space-y-1.5">
              {groups.map((g, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-destructive">{g.count}×</span>
                    <span className="font-mono text-[11px] text-destructive bg-destructive/15 rounded px-1.5 py-0.5">{g.code}</span>
                    <span className="text-foreground truncate">{g.reason}</span>
                  </div>
                  {g.hint && <p className="text-[11px] text-destructive/80 mt-0.5 ml-6">→ {g.hint}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              className="rounded-xl pl-8 h-9"
              placeholder="Search name, phone, email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-xl border bg-card px-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All ({totals.total})</option>
            <option value="submitted">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            {totals.pace_limited > 0 && <option value="pace_limited">Pace limited</option>}
            <option value="queued">Queued</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 h-9"
            onClick={() => downloadCsv(campaign.name, filtered)}
            disabled={!filtered.length}
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>

        {/* Recipient list */}
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No recipients match this filter.</div>
        ) : (
          <div className="border rounded-2xl divide-y max-h-[55vh] overflow-y-auto">
            {filtered.map((r) => {
              const sp = statusPill(isPaced(r) ? 'pace_limited' : r.status);
              const SIcon = sp.icon;
              return (
                <div key={r.id} className="p-3 hover:bg-muted/40 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {r.full_name || r.phone || r.email || 'Unknown'}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {r.phone || r.email || '—'}
                        {r.source_label ? ` · ${r.source_label}` : ` · ${r.source_type}`}
                        {r.in_window === false && ' · cold'}
                      </p>
                    </div>
                    <Badge variant="outline" className={`${sp.c} rounded-full text-[10px] uppercase shrink-0`}>
                      <SIcon className="h-3 w-3 mr-1" /> {sp.label}
                    </Badge>
                  </div>
                  {(r.status === 'failed' || r.status === 'pace_limited') && (r.error_reason || r.error_code) && (() => {
                    const explained = explainCommError(`${r.error_code ?? ''} ${r.error_reason ?? ''}`);
                    const paced = isPaced(r);
                    return (
                      <div className={`mt-1.5 text-[11px] rounded-lg px-2 py-1 ${paced ? 'text-warning bg-warning/10' : 'text-destructive bg-destructive/10'}`}>
                        <p className="font-medium">
                          {r.error_code && <span className="font-mono mr-1.5">[{r.error_code}]</span>}
                          {explained.title}
                        </p>
                        <p className="text-[10px] leading-relaxed text-foreground/70 mt-0.5">
                          {explained.what} {explained.action}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ResponsiveSheet>
  );
}

function Stat({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon?: any }) {
  return (
    <div className="rounded-2xl bg-card border p-3">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
