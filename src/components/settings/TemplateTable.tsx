import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Edit, Trash2, Send, Eye, FileText, Image as ImageIcon, Video as VideoIcon,
  CheckCircle, Clock, XCircle, PauseCircle, Search,
} from 'lucide-react';

export interface TemplateRow {
  id: string;
  name: string;
  type: string;
  trigger?: string;
  content: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  meta_template_name?: string | null;
  meta_template_status?: string | null;
  meta_rejection_reason?: string | null;
  header_type?: 'none' | 'image' | 'document' | 'video' | null;
  attachment_source?: 'none' | 'static' | 'dynamic' | null;
  live_meta_status?: string | null;
  live_meta_category?: string | null;
  live_meta_header_type?: string | null;
  live_meta_stale?: boolean | null;
  live_synced_at?: string | null;
}

export interface DeliveryStat {
  sent: number; failed: number; queued: number; delivered: number; read: number;
}

interface Props {
  channel: 'whatsapp' | 'sms' | 'email';
  templates: TemplateRow[];
  deliveryStats: Record<string, DeliveryStat>;
  isLoading?: boolean;
  onPreview: (t: TemplateRow) => void;
  onEdit: (t: TemplateRow) => void;
  onDelete: (id: string) => void;
  onSubmitMeta: (t: TemplateRow) => void;
  onCreate: () => void;
}

function metaStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<string, { label: string; icon: any; className: string }> = {
    APPROVED: { label: 'Approved', icon: CheckCircle, className: 'bg-success/10 text-success border-success/20' },
    PENDING: { label: 'Pending', icon: Clock, className: 'bg-warning/10 text-warning border-warning/20' },
    REJECTED: { label: 'Rejected', icon: XCircle, className: 'bg-destructive/10 text-destructive border-destructive/20' },
    PAUSED: { label: 'Paused', icon: PauseCircle, className: 'bg-muted text-muted-foreground border-border' },
    DISABLED: { label: 'Disabled', icon: PauseCircle, className: 'bg-muted text-muted-foreground border-border' },
  };
  const cfg = map[String(status).toUpperCase()];
  if (!cfg) return <span className="text-xs text-muted-foreground">—</span>;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

function mediaBadge(t: TemplateRow) {
  const ht = t.header_type || 'none';
  const src = t.attachment_source || 'none';
  if (ht === 'none' || src === 'none') return null;
  const Icon = ht === 'image' ? ImageIcon : ht === 'video' ? VideoIcon : FileText;
  const label = `${src === 'dynamic' ? 'Dynamic' : 'Static'} ${ht === 'document' ? 'PDF' : ht.charAt(0).toUpperCase() + ht.slice(1)}`;
  const cls = src === 'dynamic'
    ? 'bg-primary/10 text-primary border-primary/25'
    : 'bg-info/10 text-info border-info/25';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function TemplateTable({
  channel, templates, deliveryStats, isLoading,
  onPreview, onEdit, onDelete, onSubmitMeta, onCreate,
}: Props) {
  const [search, setSearch] = useState('');
  const [alignment, setAlignment] = useState<'all' | 'ready' | 'missing' | 'mismatch' | 'pending'>('all');

  const alignmentState = (t: TemplateRow) => {
    if (channel !== 'whatsapp') return 'ready';
    if (!t.meta_template_name || !t.live_meta_status || t.live_meta_stale) return 'missing';
    if (String(t.live_meta_status).toUpperCase() !== 'APPROVED') return 'pending';
    if (t.header_type && t.live_meta_header_type && t.header_type !== t.live_meta_header_type) return 'mismatch';
    return 'ready';
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (alignment !== 'all' && alignmentState(t) !== alignment) return false;
      if (!q) return true;
      return (
      [t.name, t.trigger, t.content, t.meta_template_name].some((v) =>
        String(v || '').toLowerCase().includes(q)),
      );
    });
  }, [templates, search, alignment, channel]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
      <div className="relative max-w-sm flex-1 min-w-[240px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <label htmlFor={`tpl-search-${channel}`} className="sr-only">Search templates</label>
        <Input
          id={`tpl-search-${channel}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, event or content"
          className="pl-9 rounded-xl"
        />
      </div>
        {channel === 'whatsapp' && (
          <div className="flex flex-wrap gap-1">
            {(['all', 'ready', 'missing', 'mismatch', 'pending'] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={alignment === value ? 'default' : 'outline'} onClick={() => setAlignment(value)} className="h-9 rounded-full capitalize">
                {value === 'missing' ? 'Missing / stale' : value}
              </Button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="py-12 text-center rounded-2xl bg-muted/30">
          <div className="inline-flex bg-primary/10 text-primary p-3 rounded-2xl mb-3">
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {templates.length === 0 ? 'No templates yet' : 'No templates match your search'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {templates.length === 0 ? 'Create one manually or generate with AI.' : 'Try a different keyword.'}
          </p>
          {templates.length === 0 && (
            <Button size="sm" className="mt-4 rounded-xl" onClick={onCreate}>Add template</Button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-card shadow-lg shadow-primary/5 overflow-hidden">
          <div className="max-h-[560px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead className="hidden md:table-cell">Event</TableHead>
                  <TableHead>Status</TableHead>
                  {channel === 'whatsapp' && <TableHead className="hidden lg:table-cell">Meta</TableHead>}
                  <TableHead className="hidden xl:table-cell">7-day delivery</TableHead>
                  <TableHead className="hidden lg:table-cell">Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const ds = deliveryStats[t.id];
                  return (
                    <TableRow key={t.id} className="hover:bg-muted/60 transition-colors duration-150">
                      <TableCell className="max-w-[320px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground truncate">{t.name}</span>
                          {mediaBadge(t)}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {String(t.content || '').slice(0, 90)}
                        </p>
                        {t.meta_template_status === 'REJECTED' && t.meta_rejection_reason && (
                          <p className="text-xs text-destructive mt-0.5 truncate">{t.meta_rejection_reason}</p>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">{t.trigger || 'custom'}</span>
                      </TableCell>
                      <TableCell>
                        {t.is_active
                          ? <Badge className="bg-success/10 text-success border-success/20 rounded-full">Active</Badge>
                          : <Badge variant="secondary" className="rounded-full">Inactive</Badge>}
                      </TableCell>
                      {channel === 'whatsapp' && (
                        <TableCell className="hidden lg:table-cell">
                          {metaStatusBadge(t.live_meta_status || t.meta_template_status)}
                          <Badge variant="outline" className={`mt-1 rounded-full text-[10px] ${alignmentState(t) === 'ready' ? 'border-success/20 bg-success/10 text-success' : alignmentState(t) === 'pending' ? 'border-warning/20 bg-warning/10 text-warning' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}>
                            {alignmentState(t) === 'ready' ? 'Ready' : alignmentState(t) === 'missing' ? 'Missing / stale' : alignmentState(t) === 'mismatch' ? 'Header mismatch' : 'Pending / rejected'}
                          </Badge>
                          {t.meta_template_name && (
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate max-w-[160px]">
                              {t.meta_template_name}
                            </p>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="hidden xl:table-cell">
                        {!ds || (ds.sent + ds.failed + ds.queued) === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 text-[10px]">
                            <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">{ds.sent} sent</span>
                            {ds.failed > 0 && <span className="px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">{ds.failed} failed</span>}
                            {ds.queued > 0 && <span className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning font-medium">{ds.queued} queued</span>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">{formatDate(t.updated_at || t.created_at)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {channel === 'whatsapp' && (
                            <Button
                              variant="ghost" size="icon" className="cursor-pointer"
                              onClick={() => onSubmitMeta(t)}
                              aria-label="Submit template to Meta"
                              title={t.meta_template_name ? 'Edit & resubmit to Meta' : 'Submit to Meta'}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="cursor-pointer" onClick={() => onPreview(t)} aria-label="Preview template">
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="cursor-pointer" onClick={() => onEdit(t)} aria-label="Edit template">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="text-destructive hover:text-destructive cursor-pointer"
                            onClick={() => onDelete(t.id)}
                            aria-label="Delete template"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="px-4 py-2 border-t border-border/60 text-xs text-muted-foreground">
            Showing {rows.length} of {templates.length} template{templates.length === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}
