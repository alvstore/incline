import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { measurementToAvatarSnapshot } from '@/lib/measurements/measurementToAvatar';
import type { MemberMeasurementRecord } from '@/lib/measurements/types';

interface MemberBodyAvatarSvgProps {
  measurement?: MemberMeasurementRecord | null;
  previousMeasurement?: MemberMeasurementRecord | null;
  label: string;
  memberGender?: string | null;
}

/**
 * Lightweight, gender-aware body silhouette with measurement overlays.
 * Replaces the GLB/3D canvas which depended on missing model assets and
 * always rendered a gender-ambiguous mannequin.
 */
export function MemberBodyAvatarSvg({ measurement, label, memberGender }: MemberBodyAvatarSvgProps) {
  const snapshot = useMemo(
    () => measurementToAvatarSnapshot(measurement, memberGender),
    [measurement, memberGender],
  );

  const isFemale = snapshot.genderPresentation === 'female';
  const m = measurement;

  // Map waist/hip morph to a slight horizontal scale of the silhouette
  const waistScale = 0.85 + (snapshot.morphs.waistWidth || 0.5) * 0.3; // 0.85 - 1.15
  const hipScale = 0.85 + (snapshot.morphs.hipWidth || 0.5) * 0.3;

  return (
    <Card className="relative overflow-hidden rounded-2xl border-border/40 bg-gradient-to-br from-muted via-muted to-muted shadow-xl shadow-primary/10">
      {/* Subtle grid backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '14px 14px',
        }} />

      {/* Corner brackets */}
      <BracketCorner className="top-3 left-3" rotate={0} />
      <BracketCorner className="top-3 right-3" rotate={90} />
      <BracketCorner className="bottom-3 left-3" rotate={-90} />
      <BracketCorner className="bottom-3 right-3" rotate={180} />

      <div className="relative z-10 flex items-start justify-between p-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-primary-foreground/50">Body view</p>
          <h3 className="text-base font-semibold text-primary-foreground mt-0.5">{label}</h3>
        </div>
        <Badge className="bg-card/10 text-primary-foreground/80 border-primary-foreground/10 text-[10px] uppercase tracking-wider">
          {isFemale ? 'Female silhouette' : 'Male silhouette'}
        </Badge>
      </div>

      <div className="relative z-10 px-4 pb-5 flex justify-center">
        <svg viewBox="0 0 200 360" className="h-[320px] w-auto" aria-label="Body silhouette">
          {/* Defs */}
          <defs>
            <linearGradient id="bodyFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.85)" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0.55)" />
            </linearGradient>
          </defs>

          {/* Silhouette */}
          <g transform={`translate(100,0)`}>
            {isFemale ? <FemaleSilhouette waistScale={waistScale} hipScale={hipScale} /> : <MaleSilhouette waistScale={waistScale} hipScale={hipScale} />}
          </g>

          {/* Measurement bands */}
          <MeasurementBand y={130} value={m?.chest_cm ? `${m.chest_cm}"` : '—'} label="Chest" />
          <MeasurementBand y={185} value={m?.waist_cm ? `${m.waist_cm}"` : '—'} label="Waist" />
          <MeasurementBand y={235} value={m?.hips_cm ? `${m.hips_cm}"` : '—'} label="Hips" />
        </svg>
      </div>
    </Card>
  );
}

function BracketCorner({ className, rotate }: { className: string; rotate: number }) {
  return (
    <svg className={`pointer-events-none absolute h-6 w-6 text-primary ${className}`} viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M2 9V2h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MaleSilhouette({ waistScale, hipScale }: { waistScale: number; hipScale: number }) {
  // Drawn centered on x=0
  return (
    <g fill="url(#bodyFill)" stroke="hsl(var(--primary) / 0.6)" strokeWidth="0.8">
      {/* Head */}
      <ellipse cx="0" cy="30" rx="18" ry="22" />
      {/* Neck */}
      <rect x="-7" y="48" width="14" height="10" />
      {/* Shoulders / chest (broad) */}
      <path d={`M -52 70 Q -55 90 -45 130 L ${-30 * waistScale} 175 L ${30 * waistScale} 175 L 45 130 Q 55 90 52 70 Q 25 55 0 58 Q -25 55 -52 70 Z`} />
      {/* Arms */}
      <path d="M -52 70 Q -68 105 -62 175 Q -60 200 -52 210 Q -46 195 -45 170 Q -45 130 -45 130" />
      <path d="M 52 70 Q 68 105 62 175 Q 60 200 52 210 Q 46 195 45 170 Q 45 130 45 130" />
      {/* Hips (narrower than shoulders) */}
      <path d={`M ${-30 * waistScale} 175 L ${-40 * hipScale} 220 L ${-32 * hipScale} 245 L ${32 * hipScale} 245 L ${40 * hipScale} 220 L ${30 * waistScale} 175 Z`} />
      {/* Legs */}
      <path d={`M ${-32 * hipScale} 245 Q -32 290 -28 340 L -10 340 Q -10 290 -8 250 Z`} />
      <path d={`M ${32 * hipScale} 245 Q 32 290 28 340 L 10 340 Q 10 290 8 250 Z`} />
    </g>
  );
}

function FemaleSilhouette({ waistScale, hipScale }: { waistScale: number; hipScale: number }) {
  return (
    <g fill="url(#bodyFill)" stroke="hsl(var(--primary) / 0.6)" strokeWidth="0.8">
      {/* Head */}
      <ellipse cx="0" cy="32" rx="17" ry="22" />
      {/* Neck */}
      <rect x="-6" y="50" width="12" height="9" />
      {/* Shoulders / bust */}
      <path d={`M -44 72 Q -48 95 -38 135 L ${-26 * waistScale} 180 L ${26 * waistScale} 180 L 38 135 Q 48 95 44 72 Q 22 60 0 62 Q -22 60 -44 72 Z`} />
      {/* Arms (slimmer) */}
      <path d="M -44 72 Q -58 105 -54 175 Q -52 198 -45 208 Q -40 195 -39 170 Q -39 135 -39 135" />
      <path d="M 44 72 Q 58 105 54 175 Q 52 198 45 208 Q 40 195 39 170 Q 39 135 39 135" />
      {/* Hips (wider than shoulders) */}
      <path d={`M ${-26 * waistScale} 180 L ${-44 * hipScale} 222 L ${-34 * hipScale} 250 L ${34 * hipScale} 250 L ${44 * hipScale} 222 L ${26 * waistScale} 180 Z`} />
      {/* Legs */}
      <path d={`M ${-34 * hipScale} 250 Q -34 295 -28 340 L -10 340 Q -10 295 -8 252 Z`} />
      <path d={`M ${34 * hipScale} 250 Q 34 295 28 340 L 10 340 Q 10 295 8 252 Z`} />
    </g>
  );
}

function MeasurementBand({ y, value, label }: { y: number; value: string; label: string }) {
  return (
    <g>
      <line x1="6" y1={y} x2="194" y2={y} stroke="white" strokeOpacity="0.25" strokeDasharray="3 3" strokeWidth="1" />
      <g transform={`translate(155, ${y - 10})`}>
        <rect x="0" y="0" rx="9" ry="9" width="44" height="20" fill="rgba(255,255,255,0.92)" />
        <text x="22" y="14" textAnchor="middle" fontSize="10" fill="#0f172a" fontWeight="600">{value}</text>
      </g>
      <text x="10" y={y - 4} fontSize="9" fill="white" opacity="0.6" letterSpacing="1.5">{label.toUpperCase()}</text>
    </g>
  );
}
