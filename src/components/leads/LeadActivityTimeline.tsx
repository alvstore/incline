import { useQuery } from '@tanstack/react-query';
import { leadService } from '@/services/leadService';
import { format } from 'date-fns';
import { Phone, MessageSquare, Mail, MapPin, StickyNote, ArrowRight, UserCheck, Flame, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const ACTIVITY_ICONS: Record<string, any> = {
  call: Phone,
  whatsapp: MessageSquare,
  email: Mail,
  visit: MapPin,
  note: StickyNote,
  status_change: ArrowRight,
  assignment: UserCheck,
  conversion: Flame,
  created: Clock,
  sms: MessageSquare,
};

const ACTIVITY_COLORS: Record<string, string> = {
  call: 'bg-info/10 text-info border-info/25',
  whatsapp: 'bg-success/10 text-success border-success/25',
  email: 'bg-primary/10 text-primary border-primary/25',
  visit: 'bg-warning/10 text-warning border-warning/25',
  note: 'bg-muted text-muted-foreground border-border',
  status_change: 'bg-primary/10 text-primary border-primary/20',
  assignment: 'bg-primary/10 text-primary border-primary/25',
  conversion: 'bg-success/10 text-success border-success/25',
  created: 'bg-muted text-muted-foreground border-border',
};

export function LeadActivityTimeline({ leadId }: { leadId: string }) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: () => leadService.fetchLeadActivities(leadId),
    enabled: !!leadId,
  });

  // Also load legacy followups
  const { data: followups = [] } = useQuery({
    queryKey: ['followups', leadId],
    queryFn: () => leadService.fetchFollowups(leadId),
    enabled: !!leadId,
  });

  // Merge & sort by date desc
  const allItems = [
    ...activities.map((a: any) => ({
      id: a.id,
      type: a.activity_type,
      title: a.title || a.activity_type,
      notes: a.notes,
      date: a.created_at,
      source: 'activity',
    })),
    ...followups.map((f: any) => ({
      id: f.id,
      type: 'followup',
      title: f.outcome || 'Follow-up',
      notes: f.notes,
      date: f.followup_date || f.created_at,
      source: 'followup',
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (allItems.length === 0) {
    return (
      <div className="text-center py-8">
        <StickyNote className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
      <div className="space-y-4">
        {allItems.map((item) => {
          const Icon = ACTIVITY_ICONS[item.type] || StickyNote;
          const colorClass = ACTIVITY_COLORS[item.type] || ACTIVITY_COLORS.note;
          return (
            <div key={item.id} className="flex gap-3 relative">
              <div className={`h-8 w-8 rounded-full border flex items-center justify-center shrink-0 z-10 ${colorClass}`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <time className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(item.date), 'MMM dd, HH:mm')}
                  </time>
                </div>
                {item.notes && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.notes}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
