import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertTriangle, Clock, Users, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import type { Campaign } from '@/services/campaignService';

interface CampaignDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

const statusPill = (s: string) => {
  const k = (s || '').toLowerCase();
  if (['sent', 'delivered', 'read', 'success'].includes(k)) return 'bg-success/15 text-success';
  if (['failed', 'error', 'bounced'].includes(k)) return 'bg-destructive/15 text-destructive';
  if (['queued', 'pending', 'sending'].includes(k)) return 'bg-warning/15 text-warning';
  return 'bg-muted text-foreground';
};

export function CampaignDetailDrawer({ open, onOpenChange, campaign }: CampaignDetailDrawerProps) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['campaign-runs', campaign?.id],
    queryFn: async () => {
      if (!campaign?.id) return [];
      const { data } = await supabase
        .from('campaign_runs')
        .select('id, recipient_id, recipient_phone, recipient_email, status, error, sent_at')
        .eq('campaign_id', campaign.id)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(500);
      return data || [];
    },
    enabled: !!campaign?.id && open,
  });

  // Conversion attribution: members created from same phone after campaign sent_at
  const { data: conversions = 0 } = useQuery({
    queryKey: ['campaign-conversions', campaign?.id, campaign?.sent_at],
    queryFn: async () => {
      if (!campaign?.sent_at || runs.length === 0) return 0;
      const phones = Array.from(
        new Set(runs.map((r: any) => r.recipient_phone).filter(Boolean))
      );
      if (phones.length === 0) return 0;
      const sb: any = supabase;
      const { count } = await sb
        .from('members')
        .select('id', { count: 'exact', head: true })
        .in('phone', phones)
        .gte('created_at', campaign.sent_at);
      return count || 0;
    },
    enabled: !!campaign?.sent_at && runs.length > 0 && open,
  });

  if (!campaign) return null;

  const total = runs.length;
  const sent = runs.filter((r: any) => ['sent', 'delivered', 'read'].includes((r.status || '').toLowerCase())).length;
  const failed = runs.filter((r: any) => ['failed', 'error', 'bounced'].includes((r.status || '').toLowerCase())).length;
  const queued = total - sent - failed;
  const conversionRate = sent > 0 ? ((conversions / sent) * 100).toFixed(1) : '0.0';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{campaign.name}</SheetTitle>
          <SheetDescription>
            Recipient delivery breakdown and conversion attribution
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl bg-muted p-3 text-center">
              <Users className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-xl font-bold text-foreground">{total}</p>
              <p className="text-[10px] uppercase text-muted-foreground">Total</p>
            </div>
            <div className="rounded-xl bg-success/10 p-3 text-center">
              <CheckCircle2 className="h-4 w-4 mx-auto text-success mb-1" />
              <p className="text-xl font-bold text-success">{sent}</p>
              <p className="text-[10px] uppercase text-success">Delivered</p>
            </div>
            <div className="rounded-xl bg-destructive/10 p-3 text-center">
              <AlertTriangle className="h-4 w-4 mx-auto text-destructive mb-1" />
              <p className="text-xl font-bold text-destructive">{failed}</p>
              <p className="text-[10px] uppercase text-destructive">Failed</p>
            </div>
            <div className="rounded-xl bg-warning/10 p-3 text-center">
              <Clock className="h-4 w-4 mx-auto text-warning mb-1" />
              <p className="text-xl font-bold text-warning">{queued}</p>
              <p className="text-[10px] uppercase text-warning">Queued</p>
            </div>
          </div>

          {/* Conversion strip */}
          {campaign.sent_at && (
            <div className="rounded-2xl bg-gradient-to-r from-primary to-primary text-primary-foreground p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80">
                  <TrendingUp className="h-3.5 w-3.5" /> Conversions
                </div>
                <p className="text-2xl font-bold mt-0.5">{conversions}</p>
                <p className="text-xs opacity-80 mt-0.5">
                  Members signed up from these contacts after send
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold">{conversionRate}%</p>
                <p className="text-[10px] uppercase opacity-80">conv rate</p>
              </div>
            </div>
          )}

          {/* Recipients table */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Recipients ({total})
            </h4>
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : total === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No recipients yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                {runs.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-card border border-border/50 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-foreground">
                        {r.recipient_phone || r.recipient_email || '—'}
                      </p>
                      {r.error && (
                        <p className="text-xs text-destructive truncate" title={r.error}>{r.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.sent_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(r.sent_at), 'dd MMM HH:mm')}
                        </span>
                      )}
                      <Badge className={`${statusPill(r.status)} rounded-full text-[10px] uppercase`}>
                        {r.status || 'pending'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
