import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, ChevronDown, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { consolidateVisits, formatDuration, type VisitRecord } from './attendanceRange';

interface VisitLogProps {
  records: VisitRecord[];
}

const PAGE_SIZE = 10;

/**
 * One row per gym visit (calendar day). Repeat turnstile scans are collapsed
 * into a punch trail that can be expanded.
 */
export function VisitLog({ records }: VisitLogProps) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const visits = useMemo(() => consolidateVisits(records), [records]);
  const totalPages = Math.max(1, Math.ceil(visits.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = visits.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Visit log</CardTitle>
      </CardHeader>
      <CardContent>
        {visits.length === 0 ? (
          <div className="py-10 text-center">
            <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No visits recorded in this period.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {slice.map((visit) => {
                const expanded = open === visit.key;
                const extra = visit.punches.length - 1;
                return (
                  <div key={visit.key} className="rounded-xl bg-muted/50 transition-colors duration-150 hover:bg-muted">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : visit.key)}
                      disabled={extra <= 0}
                      aria-expanded={expanded}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 p-3 text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-xl',
                        extra > 0 && 'cursor-pointer',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                          <CheckCircle className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {format(new Date(visit.firstIn), 'EEEE, dd MMM yyyy')}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            In {format(new Date(visit.firstIn), 'HH:mm')}
                            {visit.lastOut && !visit.open && ` · Out ${format(new Date(visit.lastOut), 'HH:mm')}`}
                            {extra > 0 && ` · ${visit.punches.length} scans`}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {visit.open ? (
                          <Badge className="rounded-full bg-success/10 text-xs font-medium text-success hover:bg-success/10">
                            In gym
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full text-xs">
                            {formatDuration(visit.minutes)}
                          </Badge>
                        )}
                        {extra > 0 && (
                          <ChevronDown
                            className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    </button>

                    {expanded && extra > 0 && (
                      <ul className="space-y-1.5 border-t border-border/60 px-4 py-3">
                        {visit.punches.map((p) => (
                          <li key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>In {format(new Date(p.check_in), 'HH:mm')}</span>
                            <span>{p.check_out ? `Out ${format(new Date(p.check_out), 'HH:mm')}` : 'Open'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            {visits.length > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {safePage * PAGE_SIZE + 1}–{Math.min(visits.length, (safePage + 1) * PAGE_SIZE)} of {visits.length}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
