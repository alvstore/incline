import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, Clock, XCircle, Inbox, Plus } from 'lucide-react';
import { REQUEST_ICONS } from './requestTypes';
import type { RequestKind } from './requestTypes';

export interface TimelineItem {
  id: string;
  kind: RequestKind;
  label: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reason?: string | null;
  response?: string | null;
}

interface RequestTimelineProps {
  items: TimelineItem[];
  isLoading: boolean;
  onNewRequest: () => void;
}

const STATUS_STYLES: Record<
  TimelineItem['status'],
  { badge: string; dot: string; icon: typeof Clock; label: string }
> = {
  pending: {
    badge: 'bg-warning/15 text-warning border-transparent',
    dot: 'bg-warning',
    icon: Clock,
    label: 'Pending',
  },
  approved: {
    badge: 'bg-success/15 text-success border-transparent',
    dot: 'bg-success',
    icon: CheckCircle,
    label: 'Approved',
  },
  rejected: {
    badge: 'bg-destructive/15 text-destructive border-transparent',
    dot: 'bg-destructive',
    icon: XCircle,
    label: 'Rejected',
  },
};

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

export function RequestTimeline({ items, isLoading, onNewRequest }: RequestTimelineProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter);

  return (
    <Card className="rounded-2xl border-border/60 shadow-lg shadow-primary/5">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Activity</CardTitle>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="rounded-xl">
            <TabsTrigger value="all" className="rounded-lg text-xs">All</TabsTrigger>
            <TabsTrigger value="pending" className="rounded-lg text-xs">Pending</TabsTrigger>
            <TabsTrigger value="approved" className="rounded-lg text-xs">Approved</TabsTrigger>
            <TabsTrigger value="rejected" className="rounded-lg text-xs">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm text-muted-foreground">
              {filter === 'all' ? 'No requests yet' : `No ${filter} requests`}
            </p>
            {filter === 'all' && (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={onNewRequest}>
                <Plus className="mr-2 h-4 w-4" />
                Raise your first request
              </Button>
            )}
          </div>
        ) : (
          <ol className="relative space-y-5 pl-1">
            <span
              className="absolute left-[19px] top-3 bottom-3 w-px bg-border"
              aria-hidden="true"
            />
            {filtered.map((item) => {
              const style = STATUS_STYLES[item.status];
              const Icon = REQUEST_ICONS[item.kind];
              return (
                <li key={item.id} className="relative flex gap-3">
                  <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted ring-4 ring-card">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${style.dot}`}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <Badge className={`rounded-full text-[11px] font-medium ${style.badge}`}>
                        {style.label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Submitted {format(new Date(item.createdAt), 'dd MMM yyyy')}
                    </p>
                    {item.reason && (
                      <p className="mt-2 text-sm text-foreground/80">{item.reason}</p>
                    )}
                    {item.response && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Response:</span> {item.response}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
