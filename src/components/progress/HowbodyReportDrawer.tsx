import { useEffect, useMemo, useState } from 'react';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, Scan, PersonStanding, FileCheck2, FileText, Images } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import type { HowbodyReportRow } from '@/hooks/useHowbodyReports';

interface Props {
  report: HowbodyReportRow | null;
  onOpenChange: (open: boolean) => void;
}

type AnyReport = HowbodyReportRow & Record<string, unknown>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Reference bands used by the in-club scanner report. */
interface Band { low: number; high: number }

function zone(value: number | null, band?: Band): 'low' | 'normal' | 'high' | null {
  if (value == null || !band) return null;
  if (value < band.low) return 'low';
  if (value > band.high) return 'high';
  return 'normal';
}

const zoneTone: Record<string, string> = {
  low: 'bg-amber-100 text-amber-700',
  normal: 'bg-emerald-100 text-emerald-700',
  high: 'bg-red-100 text-red-700',
};

const zoneLabel: Record<string, string> = { low: 'Under', normal: 'Normal', high: 'Over' };

export function HowbodyReportDrawer({ report, onOpenChange }: Props) {
  const [full, setFull] = useState<AnyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  useEffect(() => {
    if (!report) { setFull(null); return; }
    setFull(report as AnyReport);
    setLoading(true);
    const table = report.type === 'body' ? 'howbody_body_reports' : 'howbody_posture_reports';
    supabase.from(table).select('*').eq('id', report.id).maybeSingle()
      .then(({ data }) => {
        if (data) setFull({ ...(report as AnyReport), ...(data as Record<string, unknown>) });
        setLoading(false);
      });
  }, [report]);

  const isBody = report?.type === 'body';
  const isOriginal = report?.pdf_source === 'howbody_original';

  return (
    <>
      <Sheet open={!!report} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="space-y-2">
            <SheetTitle className="flex items-center gap-2">
              {isBody ? <Scan className="h-5 w-5 text-primary" /> : <PersonStanding className="h-5 w-5 text-primary" />}
              {isBody ? 'Body Composition Report' : 'Posture Analysis Report'}
            </SheetTitle>
            <SheetDescription>
              {report && format(new Date(report.test_time || report.created_at), 'PPpp')}
            </SheetDescription>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  isOriginal ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isOriginal ? (
                  <><FileCheck2 className="mr-1 h-3 w-3" /> Official HOWBODY document</>
                ) : (
                  <><FileText className="mr-1 h-3 w-3" /> Scanner telemetry summary</>
                )}
              </Badge>
              {full?.equipment_no ? (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  Scanner {String(full.equipment_no)}
                </Badge>
              ) : null}
            </div>
          </SheetHeader>

          {loading && !full ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isBody ? (
            <BodyMetrics r={full} />
          ) : (
            <PostureMetrics r={full} onZoom={setZoomImg} />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!zoomImg} onOpenChange={(o) => !o && setZoomImg(null)}>
        <DialogContent className="max-w-2xl p-2">
          {zoomImg ? <img src={zoomImg} alt="Posture scan view" className="max-h-[80vh] w-full rounded-xl object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Gauge({
  label, value, suffix, band, hint,
}: { label: string; value: unknown; suffix?: string; band?: Band; hint?: string }) {
  const v = num(value);
  const z = zone(v, band);
  const pct = useMemo(() => {
    if (v == null || !band) return null;
    const span = band.high - band.low;
    const min = band.low - span;
    const max = band.high + span;
    return Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  }, [v, band]);

  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm shadow-slate-200/60 transition-all duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {z ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${zoneTone[z]}`}>{zoneLabel[z]}</span>
        ) : null}
      </div>
      <p className="mt-1 text-xl font-bold text-slate-900">
        {v ?? '—'}
        {v != null && suffix ? <span className="ml-1 text-xs font-normal text-slate-500">{suffix}</span> : null}
      </p>
      {pct != null ? (
        <div className="mt-2">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="absolute inset-y-0 left-1/3 w-1/3 bg-emerald-200" />
            <div
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 ring-2 ring-white"
              style={{ left: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Healthy range {band!.low}–{band!.high}{suffix ? ` ${suffix}` : ''}
          </p>
        </div>
      ) : hint ? (
        <p className="mt-1 text-[10px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function BodyMetrics({ r }: { r: AnyReport | null }) {
  if (!r) return null;
  const isFemale = String((r.full_payload as Record<string, unknown>)?.sex ?? '').toLowerCase().startsWith('f');
  const fatBand: Band = isFemale ? { low: 21, high: 33 } : { low: 10, high: 20 };

  return (
    <div className="mt-4 space-y-5">
      <Section title="Key results">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Gauge label="Health score" value={r.health_score} band={{ low: 70, high: 100 }} />
          <Gauge label="Weight" value={r.weight} suffix="kg" />
          <Gauge label="BMI" value={r.bmi} band={{ low: 18.5, high: 24.9 }} />
          <Gauge label="Body fat" value={r.pbf} suffix="%" band={fatBand} />
          <Gauge label="Muscle (SMM)" value={r.smm} suffix="kg" />
          <Gauge label="Visceral fat" value={r.vfr} band={{ low: 1, high: 9 }} />
        </div>
      </Section>

      <Section title="Metabolism & hydration">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Gauge label="Body water" value={r.tbw} suffix="kg" />
          <Gauge label="BMR" value={r.bmr} suffix="kcal" hint="Daily calories at rest" />
          <Gauge label="Metabolic age" value={r.metabolic_age} suffix="yrs" />
          <Gauge label="Intracellular water" value={r.icf} suffix="L" />
          <Gauge label="Extracellular water" value={r.ecf} suffix="L" />
          <Gauge label="Waist-hip ratio" value={r.whr} band={{ low: 0.7, high: isFemale ? 0.85 : 0.9 }} />
        </div>
      </Section>

      <Section title="Coaching targets">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Gauge label="Target weight" value={r.target_weight} suffix="kg" />
          <Gauge label="Weight control" value={r.weight_control} suffix="kg" />
          <Gauge label="Fat control" value={r.fat_control} suffix="kg" />
          <Gauge label="Muscle control" value={r.muscle_control} suffix="kg" />
        </div>
      </Section>
    </div>
  );
}

const POSTURE_FIELDS: { key: string; label: string }[] = [
  { key: 'head_forward', label: 'Head forward' },
  { key: 'head_slant', label: 'Head tilt' },
  { key: 'high_low_shoulder', label: 'Shoulder balance' },
  { key: 'round_shoulder_left', label: 'Round shoulder (L)' },
  { key: 'round_shoulder_right', label: 'Round shoulder (R)' },
  { key: 'pelvis_forward', label: 'Pelvic tilt' },
  { key: 'pelvis_slant', label: 'Pelvic slant' },
  { key: 'leg_length_diff', label: 'Leg length difference' },
  { key: 'knee_eversion_left', label: 'Knee alignment (L)' },
  { key: 'knee_eversion_right', label: 'Knee alignment (R)' },
  { key: 'body_slope', label: 'Body slope' },
];

function PostureMetrics({ r, onZoom }: { r: AnyReport | null; onZoom: (u: string) => void }) {
  if (!r) return null;
  const photos = [
    { label: 'Front', url: r.front_img },
    { label: 'Left', url: r.left_img },
    { label: 'Right', url: r.right_img },
    { label: 'Back', url: r.back_img },
  ].filter((p) => typeof p.url === 'string' && p.url);

  const measures = POSTURE_FIELDS
    .map((f) => ({ ...f, value: num(r[f.key]) }))
    .filter((f) => f.value != null);

  return (
    <div className="mt-4 space-y-5">
      <Section title="Overall">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Gauge label="Posture score" value={r.score} band={{ low: 70, high: 100 }} />
          <Gauge label="Body slope" value={r.body_slope} hint="Lower is straighter" />
          <Gauge label="Head forward" value={r.head_forward} hint="Lower is better" />
        </div>
      </Section>

      {photos.length > 0 && (
        <Section title="Scanner views">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onZoom(String(p.url))}
                aria-label={`Open ${p.label} view`}
                className="group overflow-hidden rounded-2xl bg-slate-100 shadow-sm transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <img
                  src={String(p.url)}
                  alt={`${p.label} posture view`}
                  loading="lazy"
                  className="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                <span className="flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-slate-600">
                  <Images className="h-3 w-3" /> {p.label}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {measures.length > 0 && (
        <Section title="Alignment assessment">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm shadow-slate-200/60">
            {measures.map((m, i) => (
              <div
                key={m.key}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm ${
                  i % 2 ? 'bg-slate-50/60' : ''
                }`}
              >
                <span className="text-slate-600">{m.label}</span>
                <span className="font-semibold text-slate-900">{m.value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
