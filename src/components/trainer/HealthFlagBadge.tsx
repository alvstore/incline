import { HeartPulse } from 'lucide-react';
import { healthFlags } from '@/lib/trainers/clientBrief';

/** Icon + text badge (not colour-only). Renders nothing when there's no real condition. */
export function HealthFlagBadge({ conditions, onClick }: { conditions?: string | null; onClick?: () => void }) {
  const flags = healthFlags(conditions);
  if (!flags.length) return null;
  const label = `Health note: ${flags.join(', ')}`;
  const cls = 'inline-flex min-h-[28px] items-center gap-1 rounded-full border border-warning/20 bg-warning/10 px-2.5 text-xs font-medium text-warning';
  const content = (<><HeartPulse className="h-3.5 w-3.5" aria-hidden />Health note{flags.length > 1 ? ` · ${flags.length}` : ''}</>);
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={`${label}. Open health brief`}
      className={`${cls} cursor-pointer transition-colors hover:bg-warning/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      {content}
    </button>
  ) : <span className={cls} title={label}>{content}</span>;
}
