import { useEffect, useState } from 'react';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Scan, PersonStanding } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import type { HowbodyReportRow } from '@/hooks/useHowbodyReports';

interface Props {
  report: HowbodyReportRow | null;
  onOpenChange: (open: boolean) => void;
}

export function HowbodyReportDrawer({ report, onOpenChange }: Props) {
  const [full, setFull] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!report) { setFull(null); return; }
    setLoading(true);
    const table = report.type === 'body' ? 'howbody_body_reports' : 'howbody_posture_reports';
    supabase.from(table).select('*').eq('id', report.id).maybeSingle()
      .then(({ data }) => { setFull(data); setLoading(false); });
  }, [report]);

  const isBody = report?.type === 'body';

  return (
    <Sheet open={!!report} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isBody ? <Scan className="h-5 w-5 text-primary" /> : <PersonStanding className="h-5 w-5 text-primary" />}
            {isBody ? 'Body Composition Report' : 'Posture Analysis Report'}
          </SheetTitle>
          <SheetDescription>
            {report && format(new Date(report.test_time || report.created_at), 'PPpp')}
          </SheetDescription>
        </SheetHeader>

        {loading || !full ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isBody ? (
          <BodyMetrics r={full} />
        ) : (
          <PostureMetrics r={full} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, suffix }: { label: string; value: any; suffix?: string }) {
  return (
    <Card className="rounded-xl border-border/60">
      <CardContent className="p-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold">
          {value ?? '-'}{value != null && suffix ? <span className="ml-1 text-xs font-normal text-muted-foreground">{suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}

function BodyMetrics({ r }: { r: any }) {
  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Health Score" value={r.health_score} />
        <Stat label="Weight" value={r.weight} suffix="kg" />
        <Stat label="BMI" value={r.bmi} />
        <Stat label="Body Fat" value={r.pbf} suffix="%" />
        <Stat label="Muscle (SMM)" value={r.smm} suffix="kg" />
        <Stat label="Body Water" value={r.tbw} suffix="kg" />
        <Stat label="BMR" value={r.bmr} suffix="kcal" />
        <Stat label="Visceral Fat" value={r.vfr} />
        <Stat label="Metabolic Age" value={r.metabolic_age} />
      </div>

      <div className="rounded-xl border border-border/60 p-3">
        <p className="text-xs font-semibold mb-2">Targets</p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Target Weight" value={r.target_weight} suffix="kg" />
          <Stat label="Weight Control" value={r.weight_control} suffix="kg" />
          <Stat label="Fat Control" value={r.fat_control} suffix="kg" />
          <Stat label="Muscle Control" value={r.muscle_control} suffix="kg" />
          <Stat label="ICF" value={r.icf} suffix="L" />
          <Stat label="ECF" value={r.ecf} suffix="L" />
        </div>
      </div>
    </div>
  );
}

function PostureMetrics({ r }: { r: any }) {
  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Posture Score" value={r.score} />
        <Stat label="Head Forward" value={r.head_forward} />
        <Stat label="Shoulder Balance" value={r.high_low_shoulder} />
        <Stat label="Pelvis Forward" value={r.pelvis_forward} />
        <Stat label="Body Slope" value={r.body_slope} />
      </div>
      {r.full_payload && (
        <details className="rounded-xl border border-border/60 p-3">
          <summary className="cursor-pointer text-xs font-semibold">Raw measurements</summary>
          <pre className="mt-2 max-h-64 overflow-auto text-[11px]">{JSON.stringify(r.full_payload, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
