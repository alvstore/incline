import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, XCircle, AlertTriangle, Plus, ShieldAlert, Clock, UserCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface BookingStatusTimelineProps {
  bookingId: string;
}

const EVENT_META: Record<string, { icon: any; color: string; label: string }> = {
  created: { icon: Plus, color: 'text-success bg-success/10', label: 'Created' },
  force_added: { icon: ShieldAlert, color: 'text-warning bg-warning/10', label: 'Force-added' },
  cancelled: { icon: XCircle, color: 'text-destructive bg-destructive/10', label: 'Cancelled' },
  no_show: { icon: AlertTriangle, color: 'text-warning bg-warning/10', label: 'No-show' },
  checked_in: { icon: UserCheck, color: 'text-primary bg-primary/10', label: 'Checked-in' },
  completed: { icon: CheckCircle2, color: 'text-success bg-success/10', label: 'Completed' },
  status_change: { icon: Clock, color: 'text-muted-foreground bg-muted', label: 'Status change' },
};

export function BookingStatusTimeline({ bookingId }: BookingStatusTimelineProps) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['booking-audit', bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_audit_log' as any)
        .select('id, event_type, from_status, to_status, actor_id, actor_role, reason, metadata, created_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const actorIds = [...new Set((data || []).map((d: any) => d.actor_id).filter(Boolean))];
      let names: Record<string, string> = {};
      if (actorIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', actorIds);
        names = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.id] = p.full_name || 'Unknown';
          return acc;
        }, {});
      }
      return (data || []).map((e: any) => ({ ...e, actor_name: e.actor_id ? names[e.actor_id] || 'Unknown' : null }));
    },
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2">Loading timeline…</div>;
  }
  if (!events.length) {
    return <div className="text-xs text-muted-foreground py-2">No history recorded.</div>;
  }

  return (
    <ol className="relative border-l border-border ml-3 space-y-4 py-2">
      {events.map((e: any) => {
        const meta = EVENT_META[e.event_type] || EVENT_META.status_change;
        const Icon = meta.icon;
        return (
          <li key={e.id} className="ml-6">
            <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${meta.color} ring-4 ring-card`}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{meta.label}</span>
              {e.from_status && e.to_status && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {e.from_status} → {e.to_status}
                </Badge>
              )}
              {e.actor_role && (
                <Badge variant="secondary" className="text-[10px] capitalize">{e.actor_role}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(e.created_at), 'dd MMM yyyy · HH:mm')}
              {e.actor_name ? ` · by ${e.actor_name}` : ''}
            </p>
            {e.reason && <p className="text-xs text-foreground/80 mt-1 italic">"{e.reason}"</p>}
          </li>
        );
      })}
    </ol>
  );
}
