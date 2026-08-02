import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { RecordMeasurementDrawer } from '@/components/members/RecordMeasurementDrawer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMemberData } from '@/hooks/useMemberData';
import { MeasurementProgressView } from '@/components/members/MeasurementProgressView';
import { ScanQuotaStrip } from '@/components/progress/ScanQuotaStrip';
import { HowbodyReportsCard } from '@/components/progress/HowbodyReportsCard';
import { useScanQuota } from '@/hooks/useHowbodyReports';
import {
  TrendingUp,
  Activity,
  UtensilsCrossed,
  AlertCircle,
  Loader2,
  Scale,
  Ruler,
  Box,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

export default function MyProgress() {
  const { member, measurements, isLoading: memberLoading } = useMemberData();
  const { data: quota } = useScanQuota(member?.id);
  const [recordOpen, setRecordOpen] = useState(false);

  if (memberLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const latestMeasurement = measurements[0];
  const previousMeasurement = measurements[1];

  const getChange = (current: number | null, previous: number | null) => {
    if (!current || !previous) return null;
    return current - previous;
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Progress</h1>
            <p className="text-muted-foreground">
              Track your fitness journey with secure photos and a premium 3D body view.
            </p>
          </div>
          <Button onClick={() => setRecordOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4 mr-2" />
            Record measurements
          </Button>
        </div>

        {/* Hero */}
        <Card className="overflow-hidden rounded-2xl border-border/60 bg-card shadow-lg shadow-primary/5">
          <CardContent className="grid gap-4 bg-gradient-to-r from-primary to-primary/85 p-6 text-primary-foreground md:grid-cols-[1.15fr_0.85fr] md:items-center">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-primary-foreground/75">
                <Box className="h-3.5 w-3.5" />
                Member 3D Progress
              </div>
              <h2 className="text-2xl font-semibold">
                See your latest shape, private photos, and body changes in one place.
              </h2>
              <p className="max-w-2xl text-sm text-primary-foreground/80">
                Your progress tab compares your latest and previous measurement snapshots with signed photo
                access and an interactive rotating avatar.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-primary-foreground/10 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">
                  Latest check-in
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {latestMeasurement ? format(new Date(latestMeasurement.recorded_at), 'dd MMM') : '--'}
                </p>
              </div>
              <div className="rounded-2xl bg-primary-foreground/10 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-primary-foreground/70">
                  Comparison ready
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {measurements.length > 1 ? 'Yes' : 'Need 2 scans'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick stats */}
        {latestMeasurement && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Scale className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-sm text-muted-foreground">Weight</p>
                    <p className="text-2xl font-bold">{latestMeasurement.weight_kg || '-'} kg</p>
                    {previousMeasurement && (
                      <p
                        className={`text-sm ${
                          getChange(latestMeasurement.weight_kg, previousMeasurement.weight_kg)! < 0
                            ? 'text-success'
                            : 'text-destructive'
                        }`}
                      >
                        {getChange(latestMeasurement.weight_kg, previousMeasurement.weight_kg)?.toFixed(1)} kg
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Ruler className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-sm text-muted-foreground">Height</p>
                    <p className="text-2xl font-bold">{latestMeasurement.height_cm || '-'} cm</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <TrendingUp className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-sm text-muted-foreground">Body Fat</p>
                    <p className="text-2xl font-bold">
                      {latestMeasurement.body_fat_percentage || '-'}%
                    </p>
                    {previousMeasurement && (
                      <p
                        className={`text-sm ${
                          getChange(
                            latestMeasurement.body_fat_percentage,
                            previousMeasurement.body_fat_percentage,
                          )! < 0
                            ? 'text-success'
                            : 'text-destructive'
                        }`}
                      >
                        {getChange(
                          latestMeasurement.body_fat_percentage,
                          previousMeasurement.body_fat_percentage,
                        )?.toFixed(1)}
                        %
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Activity className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-sm text-muted-foreground">Last Updated</p>
                    <p className="text-lg font-bold">
                      {format(new Date(latestMeasurement.recorded_at), 'dd MMM')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* HOWBODY: scan quota + reports */}
        <ScanQuotaStrip body={quota?.body} posture={quota?.posture} />
        <HowbodyReportsCard memberId={member.id} />

        {/* Progress Chart */}
        <MeasurementProgressView memberId={member.id} />

        {/* Cross-link to Workout & Diet (no duplicate content) */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/50 shadow-sm shadow-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-5 w-5 text-primary" />
                Workout Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                View your assigned workout plan and today's training session.
              </p>
              <Button asChild size="sm">
                <Link to="/my-workout">
                  Open <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="border-border/50 shadow-sm shadow-success/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UtensilsCrossed className="h-5 w-5 text-success" />
                Diet Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                View your nutrition plan with meal breakdowns and macro targets.
              </p>
              <Button asChild size="sm" variant="secondary">
                <Link to="/my-diet">
                  Open <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <RecordMeasurementDrawer
        open={recordOpen}
        onOpenChange={setRecordOpen}
        memberId={member.id}
        memberName={(member as any)?.profiles?.full_name || member.member_code || 'Me'}
        memberGender={(member as any)?.gender}
      />
    </AppLayout>
  );
}
