import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';

export interface TrendPoint {
  label: string;
  value: number;
}

interface AttendanceTrendProps {
  points: TrendPoint[];
  title: string;
}

/** Lightweight bar chart of visits per bucket (day or month). */
export function AttendanceTrend({ points, title }: AttendanceTrendProps) {
  const max = Math.max(1, ...points.map((p) => p.value));

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No visits in this period yet.</p>
        ) : (
          <div className="flex h-40 items-end gap-1 overflow-x-auto">
            {points.map((p) => (
              <div key={p.label} className="flex min-w-[18px] flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end">
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-primary to-accent transition-all duration-200"
                    style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? '4px' : '0px' }}
                    title={`${p.label}: ${p.value} visit${p.value === 1 ? '' : 's'}`}
                  />
                </div>
                <span className="truncate text-[10px] text-muted-foreground">{p.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
