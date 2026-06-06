// Grouped, label-aware "Applies to" picker for AI brain entries.
// Reads live purposes from `ai_purposes` so new handles auto-appear.
import { useMemo } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useAiPurposes,
  groupPurposes,
  type PurposeMeta,
} from '@/lib/ai/purposeRegistry';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export function AppliesToPicker({ value, onChange }: Props) {
  const { data: registry = [], isLoading } = useAiPurposes();

  const selected = value.length ? value : ['all'];
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const knownKeys = useMemo(() => new Set(registry.map((p) => p.key)), [registry]);
  const unknownKeys = useMemo(
    () => selected.filter((k) => !knownKeys.has(k) && k !== 'all'),
    [selected, knownKeys],
  );

  const groups = useMemo(() => groupPurposes(registry), [registry]);

  const totalHandles = registry.filter((p) => !p.isWildcard).length;
  const matchedHandles = selectedSet.has('all')
    ? totalHandles
    : registry.filter((p) => !p.isWildcard && selectedSet.has(p.key)).length;

  const summaryTitles = selectedSet.has('all')
    ? ['Every AI handle']
    : registry
        .filter((p) => !p.isWildcard && selectedSet.has(p.key))
        .map((p) => p.title);

  function toggle(key: string) {
    const cur = new Set(selected);
    const isOn = cur.has(key);
    if (key === 'all') {
      // Selecting `all` clears everything else; deselecting falls back to empty.
      if (isOn) onChange([]);
      else onChange(['all']);
      return;
    }
    cur.delete('all');
    if (isOn) cur.delete(key);
    else cur.add(key);
    onChange(Array.from(cur));
  }

  function selectAllNonWildcard() {
    onChange(registry.filter((p) => !p.isWildcard).map((p) => p.key));
  }

  function clearAll() {
    onChange(['all']);
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Pick which AI handles consume this entry.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAllNonWildcard}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              Select all
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            >
              Reset to wildcard
            </button>
          </div>
        </div>

        <div className="rounded-xl border bg-slate-50/60 p-3 space-y-3 max-h-[360px] overflow-y-auto">
          {isLoading && (
            <p className="text-xs text-slate-400">Loading handles…</p>
          )}

          {groups.map(({ group, items }) => (
            <div key={group} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((p) => (
                  <PurposeChip
                    key={p.key}
                    meta={p}
                    active={selectedSet.has(p.key)}
                    onToggle={() => toggle(p.key)}
                  />
                ))}
              </div>
            </div>
          ))}

          {unknownKeys.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-amber-200">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Unknown keys (legacy)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unknownKeys.map((k) => (
                  <Tooltip key={k}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onChange(selected.filter((s) => s !== k))}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        <span className="font-mono">{k}</span>
                        <X className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Not in the live AI purposes registry. Click to remove.
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">
            Applies to {matchedHandles} of {totalHandles} handles
          </span>
          {summaryTitles.length > 0 && (
            <>
              {' · '}
              {summaryTitles.slice(0, 3).join(', ')}
              {summaryTitles.length > 3 && ` +${summaryTitles.length - 3} more`}
            </>
          )}
        </p>
      </div>
    </TooltipProvider>
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _suppress() {
    // titleFor is re-exported for callers; keep import side-effect alive.
    void titleFor;
  }
}

function PurposeChip({
  meta,
  active,
  onToggle,
}: {
  meta: PurposeMeta;
  active: boolean;
  onToggle: () => void;
}) {
  const disabled = !meta.enabled && !meta.isWildcard;
  const base =
    'text-xs px-2.5 py-1 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const cls = active
    ? meta.isWildcard
      ? 'bg-violet-600 text-white border-violet-600'
      : 'bg-indigo-600 text-white border-indigo-600'
    : disabled
      ? 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100';

  const chip = (
    <button type="button" onClick={onToggle} className={`${base} ${cls}`}>
      {meta.title}
    </button>
  );

  if (!disabled && !meta.description) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        <div className="space-y-0.5">
          <p className="text-xs font-mono text-slate-300">{meta.key}</p>
          {meta.description && <p className="text-xs">{meta.description}</p>}
          {disabled && (
            <p className="text-xs text-amber-300">
              Handle disabled — entry will not be consumed until enabled.
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
