import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightLeft, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { MemberMeasurementRecord } from '@/lib/measurements/types';
import { buildMeasurementCallouts } from '@/lib/measurements/measurementToAvatar';
import { MemberBodyAvatarCanvas } from './MemberBodyAvatarCanvas';

interface BodyComparisonViewProps {
  latest?: MemberMeasurementRecord | null;
  previous?: MemberMeasurementRecord | null;
  memberGender?: string | null;
  memberId?: string | null;
}

function getCalloutIcon(direction: 'up' | 'down' | 'stable') {
  if (direction === 'up') return TrendingUp;
  if (direction === 'down') return TrendingDown;
  return Minus;
}

export function BodyComparisonView({ latest, previous, memberGender, memberId }: BodyComparisonViewProps) {
  const callouts = buildMeasurementCallouts(latest, previous).slice(0, 4);

  // Only show a side-by-side comparison when there genuinely is an earlier
  // check-in. With a single scan we used to render the same body twice.
  const hasComparison = Boolean(previous && previous.id !== latest?.id);

  return (
    <div className="space-y-5">
      <div className={`grid min-w-0 gap-5 ${hasComparison ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
        {hasComparison && (
          <MemberBodyAvatarCanvas useScanner={false} measurement={previous} previousMeasurement={latest} label="Previous measurements" memberGender={memberGender} />
        )}
        <MemberBodyAvatarCanvas
          memberId={memberId}
          measurement={latest}
          previousMeasurement={previous}
          label={hasComparison ? 'Current form' : 'Latest scan'}
          memberGender={memberGender}
        />
      </div>
        <Card className="min-w-0 rounded-2xl border-border bg-card">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full bg-accent/10 p-2 text-accent">
                <ArrowRightLeft className="h-4 w-4" />
              </span>
              Progress summary
            </div>
            <CardTitle className="text-xl">{hasComparison ? 'Changes since your last check-in' : 'Your starting point'}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest update {latest?.recorded_at ? format(new Date(latest.recorded_at), 'dd MMM yyyy') : 'not available'}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {callouts.length ? (
              callouts.map((callout) => {
                const Icon = getCalloutIcon(callout.direction);
                const tone = callout.direction === 'stable' ? 'bg-muted text-muted-foreground' : 'bg-info/10 text-info';

                return (
                  <div key={callout.key} className="min-w-0 border-l-2 border-border py-2 pl-3">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full p-2 ${tone}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{callout.formatted}</p>
                        <p className="text-xs text-muted-foreground">Compared with the previous check-in</p>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl bg-secondary/70 p-4 text-sm text-muted-foreground">
                Your latest check-in is saved. Progress changes will appear after your next measurement.
              </div>
            )}

          </CardContent>
        </Card>
    </div>
  );
}
