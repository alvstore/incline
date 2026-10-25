import { useId } from 'react';
import { cn } from '@/lib/utils';
import { gaugePercent, type GaugeTone } from '@/lib/ui/gauge';

export interface RadialGaugeProps {
  value: number | null | undefined;
  max?: number;
  tone?: GaugeTone;
  size?: number;
  centerValue: string;
  centerLabel?: string;
  className?: string;
  ariaLabel: string;
}

const TONE_VAR: Record<GaugeTone, string> = {
  success: '--success',
  warning: '--warning',
  destructive: '--destructive',
  muted: '--muted-foreground',
};

/** 270° score arc with gradient stroke and an end-dot marker. */
export function RadialGauge({ value, max = 100, tone = 'success', size = 140, centerValue, centerLabel, className, ariaLabel }: RadialGaugeProps) {
  const id = useId().replace(/:/g, '');
  const pct = gaugePercent(value, max);
  const stroke = 12;
  const r = (size - stroke) / 2 - 2;
  const c = size / 2;
  const sweep = 270;
  const circ = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circ;
  const filled = (pct / 100) * arcLen;
  const angle = ((135 + (sweep * pct) / 100) * Math.PI) / 180;
  const dotX = c + r * Math.cos(angle);
  const dotY = c + r * Math.sin(angle);
  const color = `hsl(var(${TONE_VAR[tone]}))`;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circ}`} transform={`rotate(135 ${c} ${c})`} />
        {pct > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke={`url(#g-${id})`} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${filled} ${circ}`} transform={`rotate(135 ${c} ${c})`}
            className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700" />
        )}
        {pct > 0 && <circle cx={dotX} cy={dotY} r={stroke / 2 - 2} fill="hsl(var(--card))" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums leading-none text-foreground">{centerValue}</span>
        {centerLabel && <span className="mt-1 text-xs text-muted-foreground">{centerLabel}</span>}
      </div>
    </div>
  );
}
