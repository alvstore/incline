import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Scan,
  PersonStanding,
  Eye,
  Download,
  Printer,
  Send,
  Loader2,
  CheckCircle2,
  Clock3,
  Ban,
  Mail,
  MessageCircle,
  Upload,
  FileCheck2,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useHowbodyReports, useScanQuota, type HowbodyReportRow } from '@/hooks/useHowbodyReports';
import { HowbodyReportDrawer } from '@/components/progress/HowbodyReportDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';

interface Props {
  memberId: string;
}

const statusLabel = (status?: string | null) => {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'read') return 'Read';
  if (s === 'delivered') return 'Delivered';
  if (s === 'sent') return 'Sent';
  if (s === 'suppressed') return 'Not sent';
  if (s === 'skipped') return 'Skipped';
  if (s === 'failed' || s === 'bounced') return 'Failed';
  return 'Pending';
};

const statusTone = (status?: string | null) => {
  const s = String(status || '').toLowerCase();
  if (['sent', 'delivered', 'read'].includes(s)) return 'bg-emerald-100 text-emerald-700';
  if (['failed', 'bounced', 'suppressed'].includes(s)) return 'bg-red-100 text-red-700';
  return 'bg-slate-100 text-slate-600';
};

export function MemberScanReportsTab({ memberId }: Props) {
  const { data: rows = [], isLoading, isError, refetch } = useHowbodyReports(memberId, 20);
  const { data: quota } = useScanQuota(memberId);
  const { roles } = useAuth();
  const canResend = can.recordPayment(roles) || can.manageSettings(roles);

  const [open, setOpen] = useState<HowbodyReportRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<HowbodyReportRow | null>(null);

  function pickOriginal(r: HowbodyReportRow) {
    setUploadTarget(r);
    fileInputRef.current?.click();
  }

  async function onOriginalPicked(file?: File | null) {
    const target = uploadTarget;
    if (!file || !target) return;
    if (file.type !== 'application/pdf') {
      toast.error('Please choose the PDF exported from the HOWBODY scanner.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('That PDF is larger than 15 MB.');
      return;
    }
    try {
      setBusy(`upload-${target.data_key}`);
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const { data, error } = await supabase.functions.invoke('upload-scan-original-pdf', {
        body: { report_id: target.id, kind: target.type, file_base64: btoa(binary) },
      });
      if (error) throw error;
      const err = (data as { error?: string })?.error;
      if (err) throw new Error(err);
      toast.success('Official HOWBODY report saved — it will be used for viewing and sending.');
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save the report');
    } finally {
      setBusy(null);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function resolvePdfUrl(r: HowbodyReportRow): Promise<string> {
    if (r.pdf_url && r.pdf_source !== 'howbody_original') return r.pdf_url;
    const { data, error } = await supabase.functions.invoke('deliver-scan-report', {
      body: { report_id: r.id, kind: r.type },
    });
    if (error) throw error;
    const url = typeof data === 'object' && data && 'pdf_url' in data ? String(data.pdf_url) : null;
    if (!url) throw new Error('Report is still being prepared');
    return url;
  }

  async function openPdf(r: HowbodyReportRow, mode: 'download' | 'print') {
    try {
      setBusy(`${mode}-${r.data_key}`);
      const url = await resolvePdfUrl(r);
      const win = window.open(url, '_blank');
      if (mode === 'print' && win) {
        // Browsers block print() until the PDF viewer has loaded.
        win.addEventListener('load', () => win.print());
        toast.info('Report opened — use the print dialog to send it to the printer.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the PDF');
    } finally {
      setBusy(null);
    }
  }

  async function resend(r: HowbodyReportRow, channel: 'whatsapp' | 'email') {
    try {
      setBusy(`send-${r.data_key}`);
      const { data, error } = await supabase.functions.invoke('deliver-scan-report', {
        body: { report_id: r.id, kind: r.type, resend: true, channels: [channel] },
      });
      if (error) throw error;
      const status =
        channel === 'email'
          ? (data as { email_status?: string })?.email_status
          : (data as { whatsapp_status?: string })?.whatsapp_status;
      if (status && ['failed', 'suppressed'].includes(status)) {
        toast.error(`${channel === 'email' ? 'Email' : 'WhatsApp'} send failed — see the status on the report.`);
      } else {
        toast.success(`Report sent again over ${channel === 'email' ? 'email' : 'WhatsApp'}.`);
      }
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not send the report');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {quota && (
        <Card className="rounded-2xl border-border/60 shadow-md shadow-primary/5">
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <QuotaBlock icon={Scan} label="Body composition" q={quota.body} />
            <QuotaBlock icon={PersonStanding} label="Posture" q={quota.posture} />
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border/60 shadow-lg shadow-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Scan className="h-4 w-4 text-primary" />
            Scan Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-xl bg-red-50 p-6 text-center text-sm text-red-700">
              Could not load this member's reports.
              <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl bg-muted/40 p-8 text-center">
              <Scan className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No scans recorded yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reports appear here automatically once the member completes a body composition or posture scan on the
                in-club scanner.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((r) => {
                const Icon = r.type === 'body' ? Scan : PersonStanding;
                const when = r.test_time || r.created_at;
                const summary =
                  r.type === 'body'
                    ? `${r.weight ?? '-'} kg · ${r.pbf ?? '-'}% BF${r.health_score ? ` · Score ${r.health_score}` : ''}`
                    : `Score ${r.score ?? '-'}${r.body_slope != null ? ` · Slope ${r.body_slope}` : ''}`;
                const rowBusy = busy?.endsWith(r.data_key);
                return (
                  <div key={`${r.type}-${r.id}`} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="rounded-full bg-primary/10 p-2 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {r.type === 'body' ? 'Body Composition' : 'Posture Analysis'}
                        </p>
                        <Badge variant="secondary" className="rounded-full text-[10px]">
                          {format(new Date(when), 'dd MMM yyyy')}
                        </Badge>
                        {r.pdf_source === 'howbody_original' ? (
                          <Badge variant="outline" className="rounded-full text-[10px]">Original report</Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{summary}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          {r.pdf_url ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Clock3 className="h-3 w-3 text-amber-500" />
                          )}
                          {r.pdf_url ? 'PDF ready' : 'PDF pending'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ${statusTone(r.whatsapp_status)}`}>
                          WhatsApp: {statusLabel(r.whatsapp_status)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ${statusTone(r.email_status)}`}>
                          Email: {statusLabel(r.email_status)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 font-medium ${statusTone(r.inapp_status)}`}>
                          In-app: {statusLabel(r.inapp_status)}
                        </span>
                      </div>
                      {r.delivery_error ? (
                        <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                          <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{r.delivery_error}</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(r)} aria-label="View report details">
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPdf(r, 'download')}
                        disabled={rowBusy}
                        aria-label="Download report PDF"
                      >
                        {busy === `download-${r.data_key}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openPdf(r, 'print')}
                        disabled={rowBusy}
                        aria-label="Print report"
                      >
                        {busy === `print-${r.data_key}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Printer className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {canResend && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" disabled={rowBusy} aria-label="Send report again">
                              {busy === `send-${r.data_key}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => resend(r, 'whatsapp')} className="cursor-pointer">
                              <MessageCircle className="mr-2 h-4 w-4" /> Send on WhatsApp
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => resend(r, 'email')} className="cursor-pointer">
                              <Mail className="mr-2 h-4 w-4" /> Send by email
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <HowbodyReportDrawer report={open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}

function QuotaBlock({
  icon: Icon,
  label,
  q,
}: {
  icon: typeof Scan;
  label: string;
  q?: {
    plan_limit: number;
    used_this_month: number;
    gift_remaining?: number;
    addon_remaining: number;
    allowed: boolean;
  };
}) {
  if (!q) return null;
  const extras: string[] = [];
  if ((q.gift_remaining ?? 0) > 0) extras.push(`+${q.gift_remaining} complimentary`);
  if (q.addon_remaining > 0) extras.push(`+${q.addon_remaining} add-on`);
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
      <div className="rounded-full bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight">{label}</p>
        <p className="text-xs leading-tight text-muted-foreground">
          {q.plan_limit > 0 ? `${q.used_this_month}/${q.plan_limit} this month` : 'Not in plan'}
          {extras.length ? ` · ${extras.join(' · ')}` : ''}
        </p>
      </div>
      <Badge variant={q.allowed ? 'secondary' : 'destructive'} className="ml-auto rounded-full text-[10px]">
        {q.allowed ? 'Available' : 'Used up'}
      </Badge>
    </div>
  );
}
