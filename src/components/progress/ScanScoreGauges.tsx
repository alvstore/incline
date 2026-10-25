import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { useLatestHowbodyScan } from '@/hooks/useLatestHowbodyScan';
import { scoreLabel, scoreTone } from '@/lib/ui/gauge';

function ScoreCard({ title, score, time }: { title: string; score: number | null | undefined; time: string | null | undefined }) {
  const tone = scoreTone(score);
  const pill = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <Card className="rounded-2xl border-border/50 shadow-sm shadow-primary/5">
      <CardContent className="flex flex-col items-center gap-2 p-5">
        <p className="self-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <RadialGauge value={score} tone={tone} centerValue={score != null ? String(Math.round(score)) : '--'} centerLabel="out of 100" ariaLabel={`${title}: ${score ?? 'no scan'} out of 100`} />
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill}`}>{scoreLabel(score)}</span>
        <p className="text-xs text-muted-foreground">{time ? `Scanned ${format(new Date(time), 'dd MMM yyyy')}` : 'Book a scan at the front desk'}</p>
      </CardContent>
    </Card>
  );
}

export function ScanScoreGauges({ memberId }: { memberId: string }) {
  const { data, isLoading, isError } = useLatestHowbodyScan(memberId);
  if (isLoading) return <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (isError || (!data?.body && !data?.posture)) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ScoreCard title="Body score" score={data.body?.health_score} time={data.body?.test_time} />
      <ScoreCard title="Posture score" score={data.posture?.score} time={data.posture?.test_time} />
    </div>
  );
}
