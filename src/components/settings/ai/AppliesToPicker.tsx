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
          <span className="text-xs text-muted-foreground">
            Pick which AI handles consume this entry.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAllNonWildcard}
              className="text-[11px] font-medium text-primary hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
            >
              Select all
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-primary rounded"
            >
              Reset to wildcard
            </button>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/60 p-3 space-y-3 max-h-[360px] overflow-y-auto">
          {isLoading && (
            <p className="text-xs text-muted-foreground">Loading handles…</p>
          )}

          {groups.map(({ group, items }) => (
            <div key={group} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            <div className="space-y-1.5 pt-2 border-t border-warning/25">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                Unknown keys (legacy)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unknownKeys.map((k) => (
                  <Tooltip key={k}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onChange(selected.filter((s) => s !== k))}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 focus:outline-none focus:ring-2 focus:ring-warning"
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

        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
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
    'text-xs px-2.5 py-1 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary';
  const cls = active
    ? meta.isWildcard
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-primary text-primary-foreground border-primary'
    : disabled
      ? 'bg-muted text-muted-foreground border-border hover:bg-muted'
      : 'bg-card text-foreground border-border hover:bg-muted';

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
          <p className="text-xs font-mono text-muted-foreground">{meta.key}</p>
          {meta.description && <p className="text-xs">{meta.description}</p>}
          {disabled && (
            <p className="text-xs text-warning">
              Handle disabled — entry will not be consumed until enabled.
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
