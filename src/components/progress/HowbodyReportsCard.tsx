import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Scan, PersonStanding, Eye, Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useHowbodyReports, type HowbodyReportRow } from '@/hooks/useHowbodyReports';
import { HowbodyReportDrawer } from './HowbodyReportDrawer';
import { toast } from 'sonner';

interface Props { memberId?: string }

export function HowbodyReportsCard({ memberId }: Props) {
  const { data: rows = [], isLoading } = useHowbodyReports(memberId, 8);
  const [open, setOpen] = useState<HowbodyReportRow | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function downloadPdf(r: HowbodyReportRow) {
    try {
      setDownloading(r.data_key);
      const { data, error } = await supabase.functions.invoke('howbody-report-pdf', {
        body: { dataKey: r.data_key, reportType: r.type },
      });
      if (error) throw error;
      const html = (data as any)?.html as string | undefined;
      if (!html) throw new Error('No report content');
      const w = window.open('', '_blank');
      if (!w) throw new Error('Popup blocked — allow popups to download.');
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    } catch (e: any) {
      toast.error(e.message || 'Could not generate PDF');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <Card className="rounded-2xl border-border/60 shadow-md shadow-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scan className="h-5 w-5 text-primary" />
            Body Scan Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl bg-muted/40 p-6 text-center">
              <Scan className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No scans yet. Use the body scanner at your gym to record your first body composition or posture scan.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {rows.map((r) => {
                const Icon = r.type === 'body' ? Scan : PersonStanding;
                const when = r.test_time || r.created_at;
                const main =
                  r.type === 'body'
                    ? `${r.weight ?? '-'} kg · ${r.pbf ?? '-'}% BF${r.health_score ? ` · Score ${r.health_score}` : ''}`
                    : `Score ${r.score ?? '-'}${r.body_slope != null ? ` · Slope ${r.body_slope}` : ''}`;
                return (
                  <div key={`${r.type}-${r.id}`} className="flex items-center gap-3 py-3">
                    <div className="rounded-full bg-primary/10 p-2 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">
                          {r.type === 'body' ? 'Body Composition' : 'Posture Analysis'}
                        </p>
                        <Badge variant="secondary" className="rounded-full text-[10px]">
                          {format(new Date(when), 'dd MMM yyyy')}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{main}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>
                      <Eye className="mr-1 h-3.5 w-3.5" /> View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadPdf(r)}
                      disabled={downloading === r.data_key}
                    >
                      {downloading === r.data_key ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-3.5 w-3.5" />
                      )}
                      PDF
                    </Button>
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
