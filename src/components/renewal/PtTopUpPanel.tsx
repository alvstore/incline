import { useEffect, useState } from 'react';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatINR } from '@/lib/renewal/conciergePricing';
import type { ConciergePtOption } from '@/types/concierge';

interface PtTopUpPanelProps {
  options: ConciergePtOption[];
  trainerName: string | null;
  trainerAvatar?: string | null;
  remaining: number;
  hasPackage: boolean;
  onSelect: (option: ConciergePtOption) => void;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function optionLabel(o: ConciergePtOption) {
  if (o.sessions > 0) return `+${o.sessions} sessions`;
  const months = Math.max(1, Math.round(o.validityDays / 30));
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** Personal-training package selector — supports session bundles and monthly coaching. */
export function PtTopUpPanel({ options, trainerName, trainerAvatar, remaining, hasPackage, onSelect }: PtTopUpPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);

  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.id === selectedId)) {
      setSelectedId(options[0].id);
    }
  }, [options, selectedId]);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const perSession = selected && selected.sessions > 0 ? selected.price / selected.sessions : 0;

  const status = hasPackage
    ? `${remaining} session${remaining === 1 ? '' : 's'} left`
    : 'No active coaching package';

  return (
    <section className="rounded-2xl bg-card p-6 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10 md:p-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personal training</p>
      <h2 className="mt-2 text-xl font-bold text-foreground">{hasPackage ? 'Top up your sessions' : 'Start personal training'}</h2>

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-muted/60 p-4">
        {trainerName ? (
          <Avatar className="h-11 w-11 ring-2 ring-primary/20">
            {trainerAvatar && <AvatarImage src={trainerAvatar} alt={trainerName} className="object-cover" />}
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials(trainerName)}</AvatarFallback>
          </Avatar>
        ) : (
          <span className="rounded-full bg-primary/10 p-2.5 text-primary">
            <UserRound className="h-5 w-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{trainerName ?? 'No trainer assigned yet'}</p>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
      </div>

      {options.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No training packages are published for your club right now. The front desk can set one up for you.
        </p>
      ) : (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Choose a package</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((option) => {
              const active = option.id === selectedId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedId(option.id)}
                  aria-pressed={active}
                  className={`min-h-[44px] cursor-pointer rounded-xl px-4 py-2.5 text-left text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring ${
                    active ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30' : 'bg-muted text-foreground hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {option.name}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-6 rounded-xl bg-muted/60 p-5">
              <p className="text-sm font-semibold text-foreground">{selected.name}</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <span className="text-3xl font-bold text-foreground">{formatINR(selected.price)}</span>
                <span className="pb-1 text-xs text-muted-foreground">
                  {perSession > 0 ? `${formatINR(perSession)} / session` : optionLabel(selected)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Valid for {selected.validityDays} days from activation</p>
              <Button
                onClick={() => onSelect(selected)}
                className="mt-5 h-12 w-full cursor-pointer rounded-xl text-sm font-semibold"
              >
                {selected.sessions > 0 ? `Add ${selected.sessions} sessions` : `Choose ${optionLabel(selected)} coaching`}
                <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default PtTopUpPanel;
