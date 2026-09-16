import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRightLeft, Sparkles, TrendingDown, TrendingUp, Minus } from 'lucide-react';
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
      <div className={`grid gap-5 ${hasComparison ? 'xl:grid-cols-[1.15fr_1.15fr_0.8fr]' : 'xl:grid-cols-[1.4fr_0.9fr]'}`}>
        {hasComparison && (
          <MemberBodyAvatarCanvas memberId={memberId} measurement={previous} previousMeasurement={latest} label="Previous form" memberGender={memberGender} />
        )}
        <MemberBodyAvatarCanvas
          memberId={memberId}
          measurement={latest}
          previousMeasurement={previous}
          label={hasComparison ? 'Current form' : 'Latest scan'}
          memberGender={memberGender}
        />
        <Card className="rounded-2xl border-border/60 bg-card shadow-lg shadow-primary/5">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full bg-accent/10 p-2 text-accent">
                <ArrowRightLeft className="h-4 w-4" />
              </span>
              Progress summary
            </div>
            <CardTitle className="text-xl">Your body is evolving</CardTitle>
            <p className="text-sm text-muted-foreground">
              Latest update {latest?.recorded_at ? format(new Date(latest.recorded_at), 'dd MMM yyyy') : 'not available'}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {callouts.length ? (
              callouts.map((callout) => {
                const Icon = getCalloutIcon(callout.direction);
                const tone = callout.direction === 'down'
                  ? 'bg-success/10 text-success'
                  : callout.direction === 'up'
                    ? 'bg-info/10 text-info'
                    : 'bg-muted text-muted-foreground';

                return (
                  <div key={callout.key} className="rounded-2xl bg-secondary/70 p-3">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full p-2 ${tone}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-medium text-foreground">{callout.formatted}</p>
                        <p className="text-xs text-muted-foreground">Compared with the previous check-in</p>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl bg-secondary/70 p-4 text-sm text-muted-foreground">
                Add one more measurement to unlock body-to-body comparison.
              </div>
            )}

            <div className="rounded-2xl bg-gradient-to-br from-accent/15 to-info/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-accent" />
                Premium motivation layer
              </div>
              <p className="text-sm text-muted-foreground">
                We prioritize consistency over unrealistic precision, so the silhouette stays believable as your measurements change.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full">Believable scaling</Badge>
                <Badge variant="secondary" className="rounded-full">Mobile tuned</Badge>
                <Badge variant="secondary" className="rounded-full">Drag enabled</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
