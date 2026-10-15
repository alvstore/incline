import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UpgradeTimelineRow } from './UpgradeTimelineRow';
import { useUpgradeSummary } from './useUpgradeSummary';

export function UpgradeDetailsPanel({ open, onOpenChange, branchId, now, showRevenue, returnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; branchId: string | null;
  now: Date; showRevenue: boolean; returnFocus: () => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [branchId, open]);
  const { data, isLoading, isError, isFetching, refetch } = useUpgradeSummary(branchId, page, open);
  const offers = data?.offers.filter(o => Date.parse(o.window_ends_at) > now.getTime()) ?? [];
  const total = Math.max(0, (data?.total ?? 0) - ((data?.offers.length ?? 0) - offers.length));
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="flex h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-xl motion-reduce:transition-none motion-reduce:animate-none [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:right-2 [&>button]:top-2" onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}>
      <SheetHeader className="shrink-0 border-b border-border p-6 pr-12 text-left">
        <SheetTitle>Annual upgrades</SheetTitle>
        <SheetDescription>15-day window · Monthly, quarterly &amp; half-yearly members</SheetDescription>
        <div className="flex items-center justify-between gap-2 pt-2"><p className="text-xs text-muted-foreground">{total} active windows · Deadline first</p><Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Refresh upgrade timelines" disabled={isFetching} onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button></div>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isError ? <div role="alert" className="space-y-3"><p className="text-sm text-muted-foreground">Couldn't load annual upgrades.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></div> : isLoading ? <div className="space-y-5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div> : offers.length ? <ul className="divide-y divide-border" aria-label="Active annual upgrade timelines">{offers.map(offer => <UpgradeTimelineRow key={offer.id} offer={offer} now={now} showRevenue={showRevenue} />)}</ul> : <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground"><CalendarClock className="h-8 w-8" /><p className="text-sm">{page ? 'No active windows on this page.' : 'No active annual upgrade windows.'}</p>{page > 0 && <Button variant="outline" onClick={() => setPage(0)}>First page</Button>}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background p-4 pb-safe">
        <p className="text-xs text-muted-foreground">Showing {offers.length} of {total} · Page {page + 1}</p>
        <div className="flex gap-2"><Button variant="outline" size="icon" className="h-11 w-11" disabled={page === 0 || isFetching} onClick={() => setPage(p => p - 1)} aria-label="Previous upgrade page"><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-11 w-11" disabled={(page + 1) * 10 >= total || isFetching} onClick={() => setPage(p => p + 1)} aria-label="Next upgrade page"><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
    </SheetContent>
  </Sheet>;
}