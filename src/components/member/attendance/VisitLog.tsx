import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, Clock } from 'lucide-react';
import { formatDuration, type VisitRecord } from './attendanceRange';

interface VisitLogProps {
  records: VisitRecord[];
}

const PAGE_SIZE = 10;

/** Paginated check-in / check-out history for the selected period. */
export function VisitLog({ records }: VisitLogProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = records.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Visit log</CardTitle>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="py-10 text-center">
            <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No visits recorded in this period.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {slice.map((record) => {
                const duration = record.check_out
                  ? Math.round((new Date(record.check_out).getTime() - new Date(record.check_in).getTime()) / 60000)
                  : null;
                return (
                  <div
                    key={record.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3 transition-colors duration-150 hover:bg-muted"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                        <CheckCircle className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{format(new Date(record.check_in), 'EEEE, dd MMM yyyy')}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          In {format(new Date(record.check_in), 'HH:mm')}
                          {record.check_out && ` · Out ${format(new Date(record.check_out), 'HH:mm')}`}
                        </p>
                      </div>
                    </div>
                    {duration !== null ? (
                      <Badge variant="outline" className="shrink-0 rounded-full text-xs">{formatDuration(duration)}</Badge>
                    ) : (
                      <Badge className="shrink-0 rounded-full bg-emerald-100 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                        In gym
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {records.length > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {safePage * PAGE_SIZE + 1}–{Math.min(records.length, (safePage + 1) * PAGE_SIZE)} of {records.length}
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
