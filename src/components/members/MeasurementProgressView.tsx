import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Box, Camera, Scale, Scan } from 'lucide-react';
import { hydrateMeasurementPhotoUrls } from '@/lib/measurements/photoSigning';
import type { MemberMeasurementRecord } from '@/lib/measurements/types';
import { MeasurementMetricsTab } from './MeasurementMetricsTab';
import { MeasurementPhotoGallery } from './MeasurementPhotoGallery';
import { MemberScanReportsTab } from './MemberScanReportsTab';
import { BodyComparisonView } from '@/components/progress3d/BodyComparisonView';
import { hasBodyShapeMeasurements } from '@/lib/measurements/measurementToAvatar';
import { ScanQuotaStrip } from '@/components/progress/ScanQuotaStrip';
import { HowbodyReportsCard } from '@/components/progress/HowbodyReportsCard';
import { useScanQuota } from '@/hooks/useHowbodyReports';

export type MeasurementProgressVariant = 'staff' | 'member';

interface MeasurementProgressViewProps {
  memberId: string;
  memberGender?: string | null;
  memberName?: string;
  memberCode?: string;
  variant?: MeasurementProgressVariant;
}

const TRIGGER =
  'min-h-11 cursor-pointer gap-2 rounded-xl text-primary-foreground/90 transition-colors duration-200 hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground data-[state=active]:bg-primary-foreground data-[state=active]:text-primary data-[state=active]:shadow-sm disabled:opacity-50';

function MemberScansPanel({ memberId }: { memberId: string }) {
  const { data: quota } = useScanQuota(memberId);
  return (
    <div className="space-y-4">
      <ScanQuotaStrip body={quota?.body} posture={quota?.posture} />
      <HowbodyReportsCard memberId={memberId} />
    </div>
  );
}

export function MeasurementProgressView({ memberId, memberGender, memberName, memberCode, variant = 'staff' }: MeasurementProgressViewProps) {
  const isMember = variant === 'member';
  const { data: measurements = [], isLoading } = useQuery({
    queryKey: ['member-measurements', memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_measurements')
        .select('*, recorded_by_profile:profiles!member_measurements_recorded_by_fkey(full_name)')
        .eq('member_id', memberId)
        .order('recorded_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return hydrateMeasurementPhotoUrls((data || []) as MemberMeasurementRecord[]);
    },
    enabled: !!memberId,
    staleTime: 25 * 60 * 1000,
    refetchInterval: 25 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const scansPanel = isMember ? <MemberScansPanel memberId={memberId} /> : <MemberScanReportsTab memberId={memberId} />;

  if (isLoading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="pt-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const latest = measurements[0];
  const previous = measurements[1];
  const hasMeasurements = !!latest;
  const diff = latest?.weight_kg && previous?.weight_kg ? latest.weight_kg - previous.weight_kg : null;
  const weightTrend = diff === null ? null : Math.abs(diff) < 0.1
    ? { text: 'Stable', color: 'text-muted-foreground' }
    : { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg`, color: 'text-muted-foreground' };
  const bmi = latest?.weight_kg && latest?.height_cm
    ? (latest.weight_kg / Math.pow(latest.height_cm / 100, 2)).toFixed(1)
    : null;
  const body3dEnabled = hasMeasurements && hasBodyShapeMeasurements(latest);

  return (
    <Tabs defaultValue={hasMeasurements ? 'measurements' : 'scans'} className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-primary to-primary/85 p-1 shadow-lg shadow-primary/20">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-transparent p-0 sm:grid-cols-4">
          <TabsTrigger value="measurements" className={TRIGGER}>
            <Scale className="h-4 w-4" /> Measurements
          </TabsTrigger>
          <TabsTrigger value="photos" disabled={!hasMeasurements} className={TRIGGER}>
            <Camera className="h-4 w-4" /> Photos
          </TabsTrigger>
          <TabsTrigger
            value="body-3d"
            disabled={!body3dEnabled}
            className={TRIGGER}
            title={body3dEnabled ? '3D body view' : 'Add body measurements (waist, chest, hips, etc.) to enable the 3D view'}
          >
            <Box className="h-4 w-4" /> 3D Body
          </TabsTrigger>
          <TabsTrigger value="scans" className={TRIGGER}>
            <Scan className="h-4 w-4" /> Scan Reports
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="measurements" className="mt-0">
        {hasMeasurements ? (
          <MeasurementMetricsTab
            latest={latest}
            previous={previous}
            weightTrend={weightTrend}
            bmi={bmi}
            history={measurements.slice(1)}
            memberName={memberName}
            memberCode={memberCode}
            hideHeadline={isMember}
          />
        ) : (
          <Card className="rounded-2xl">
            <CardContent className="pt-4 text-center">
              <Scale className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No measurements recorded yet</p>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {hasMeasurements && (
        <TabsContent value="photos" className="mt-0">
          <MeasurementPhotoGallery latest={latest} />
        </TabsContent>
      )}

      {body3dEnabled && (
        <TabsContent value="body-3d" className="mt-0">
          <BodyComparisonView latest={latest} previous={previous} memberGender={memberGender} memberId={memberId} />
        </TabsContent>
      )}

      <TabsContent value="scans" className="mt-0 space-y-4">
        {scansPanel}
      </TabsContent>
    </Tabs>
  );
}
