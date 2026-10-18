import { Activity, PhoneCall } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { dispositionLook, formatDuration, isLiveStatus, statusLook } from '@/lib/voice/voiceOutcomes';
import { voiceTime } from '@/lib/voice/automationStatus';
import type { VoiceCallRow } from '@/hooks/useVoiceOps';

interface VoiceCallFeedProps {
  rows: VoiceCallRow[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function when(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : `${voiceTime(value)} IST`;
}

function lastVisit(value?: string | null) {
  if (!value) return 'Never visited';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(d);
}

/** Scrollable list of calls — the left pane of the Voice AI command center. */
export function VoiceCallFeed({ rows, isLoading, selectedId, onSelect }: VoiceCallFeedProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <PhoneCall className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">No calls match these filters</p>
        <p className="text-xs text-muted-foreground">Clear the filters or widen the date range.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y" role="listbox" aria-label="Voice AI calls">
      {rows.map((r) => {
        const status = statusLook(r.status);
        const disposition = dispositionLook(r.disposition);
        const active = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(r.id)}
              className={`min-h-[44px] w-full cursor-pointer px-4 py-3.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active ? 'bg-secondary' : 'hover:bg-muted/50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{r.member_name ?? 'Unknown caller'}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.member_code ?? r.masked_phone ?? '—'}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    disposition?.className ?? status.className
                  }`}
                >
                  {isLiveStatus(r.status) && <Activity className="mr-1 inline h-3 w-3" aria-hidden />}
                  {disposition?.label ?? status.label}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {when(r.call_started_at)} · {formatDuration(r.duration_seconds)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.days_absent_at_call != null ? `Absent ${r.days_absent_at_call}d at call` : 'Retention call'}
                {' · '}Last visit: {lastVisit(r.last_visit)}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default VoiceCallFeed;
