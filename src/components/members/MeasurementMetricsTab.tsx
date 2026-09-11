import { format } from 'date-fns';
import { Camera, Printer, Ruler, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MemberMeasurementRecord } from '@/lib/measurements/types';
import { MeasurementPrintSheet } from './MeasurementPrintSheet';

interface MeasurementMetricsTabProps {
  latest: MemberMeasurementRecord;
  previous?: MemberMeasurementRecord | null;
  weightTrend?: { text: string; color: string } | null;
  bmi?: string | null;
  history: MemberMeasurementRecord[];
  memberName?: string;
  memberCode?: string;
}

export function MeasurementMetricsTab({ latest, previous, weightTrend, bmi, history, memberName, memberCode }: MeasurementMetricsTabProps) {
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/60 bg-card shadow-lg shadow-primary/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Scale className="h-4 w-4" />
              Latest Measurements
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {format(new Date(latest.recorded_at), 'dd MMM yyyy')}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-8 cursor-pointer"
                onClick={() => window.print()}
                aria-label="Print measurement summary"
              >
                <Printer className="mr-1 h-3.5 w-3.5" /> Print
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{latest.weight_kg || '--'}</p>
              <p className="text-xs text-muted-foreground">Weight (kg)</p>
              {weightTrend && <p className={`text-xs ${weightTrend.color}`}>{weightTrend.text}</p>}
            </div>
            <div>
              <p className="text-2xl font-bold">{latest.height_cm || '--'}</p>
              <p className="text-xs text-muted-foreground">Height (cm)</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{bmi || '--'}</p>
              <p className="text-xs text-muted-foreground">BMI</p>
            </div>
          </div>

          {(latest.chest_cm || latest.waist_cm || latest.hips_cm || latest.abdomen_cm || latest.shoulder_cm) && (
            <div className="border-t pt-2">
              <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Ruler className="h-3 w-3" />
                Body Measurements (cm)
              </p>
              <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-5">
                {latest.chest_cm && <Metric label="Chest" value={latest.chest_cm} />}
                {latest.waist_cm && <Metric label="Waist" value={latest.waist_cm} />}
                {latest.hips_cm && <Metric label="Hips" value={latest.hips_cm} />}
                {latest.abdomen_cm && <Metric label="Abdomen" value={latest.abdomen_cm} />}
                {latest.shoulder_cm && <Metric label="Shoulders" value={latest.shoulder_cm} />}
              </div>
            </div>
          )}

          {latest.signedPhotoUrls?.length ? (
            <div className="border-t pt-2">
              <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Camera className="h-3 w-3" />
                Latest secure photos
              </p>
              <div className="grid grid-cols-4 gap-2">
                {latest.signedPhotoUrls.slice(0, 4).map((url, index) => (
                  <img
                    key={url}
                    src={url}
                    alt={`Progress ${index + 1}`}
                    className="aspect-square w-full rounded-xl object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card className="rounded-2xl border-border/60 bg-card shadow-lg shadow-primary/5">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">Measurement History</CardTitle>
              <Badge variant="secondary" className="rounded-full text-[10px]">{history.length} entries</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-72 pr-2">
              <div className="space-y-2">
                {history.map((measurement, index) => {
                  const older = history[index + 1];
                  const delta =
                    measurement.weight_kg && older?.weight_kg ? measurement.weight_kg - older.weight_kg : null;
                  return (
                    <div key={measurement.id} className="flex items-center justify-between rounded-xl bg-secondary/70 p-3">
                      <div className="text-sm">
                        <span className="font-medium text-foreground">{measurement.weight_kg || '--'} kg</span>
                        {measurement.body_fat_percentage ? (
                          <span className="ml-2 text-muted-foreground">{measurement.body_fat_percentage}% BF</span>
                        ) : null}
                        {delta !== null && Math.abs(delta) >= 0.1 ? (
                          <span className={`ml-2 text-xs font-medium ${delta < 0 ? 'text-success' : 'text-destructive'}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(1)} kg
                          </span>
                        ) : null}
                        {previous?.id === measurement.id ? (
                          <Badge variant="secondary" className="ml-2 rounded-full">Previous baseline</Badge>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{format(new Date(measurement.recorded_at), 'dd MMM yyyy')}</p>
                        {measurement.recorded_by_profile?.full_name ? <p>By: {measurement.recorded_by_profile.full_name}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <MeasurementPrintSheet
        memberName={memberName}
        memberCode={memberCode}
        latest={latest}
        history={history}
        bmi={bmi}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-medium text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}