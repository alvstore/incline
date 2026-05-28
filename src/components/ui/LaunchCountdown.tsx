import { useEffect, useState } from 'react';
import { LAUNCH_DATE, LAUNCH_DATE_LABEL } from '@/config/publicSite';

type Parts = { d: number; h: number; m: number; s: number; done: boolean };

function diff(now: number): Parts {
  const ms = LAUNCH_DATE.getTime() - now;
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0, done: true };
  const s = Math.floor(ms / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
    done: false,
  };
}

function useCountdown(): Parts {
  const [parts, setParts] = useState<Parts>(() => diff(Date.now()));
  useEffect(() => {
    let raf = 0;
    const tick = () => setParts(diff(Date.now()));
    const id = window.setInterval(() => {
      if (!document.hidden) tick();
    }, 1000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(raf);
    };
  }, []);
  return parts;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Compact glass pill — sits under the hero headline. */
export function LaunchCountdownPill({ className = '' }: { className?: string }) {
  const { d, h, m, done } = useCountdown();
  if (done) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full bg-primary/10 backdrop-blur-md border border-primary/30 px-4 py-2 text-xs sm:text-sm font-semibold text-primary ${className}`}
        aria-live="polite"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        Doors are open
      </div>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full bg-background/60 backdrop-blur-md border border-primary/20 px-4 py-2 text-xs sm:text-sm font-semibold tracking-wide text-foreground shadow-lg shadow-primary/5 ${className}`}
      aria-label={`Launching ${LAUNCH_DATE_LABEL}, ${d} days ${h} hours ${m} minutes remaining`}
    >
      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
      <span className="text-primary uppercase tracking-[0.18em]">Doors open</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground">{LAUNCH_DATE_LABEL}</span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums font-bold text-primary">
        {d}d {pad(h)}h {pad(m)}m
      </span>
    </div>
  );
}

/** Big cinematic block — sits inside the waitlist card. */
export function LaunchCountdownBlock({ className = '' }: { className?: string }) {
  const { d, h, m, s, done } = useCountdown();
  if (done) {
    return (
      <div className={`text-center ${className}`} aria-live="polite">
        <div className="text-xs uppercase tracking-[0.3em] text-primary font-bold mb-2">
          We are live
        </div>
        <div className="text-2xl font-black text-foreground">Welcome to Incline.</div>
      </div>
    );
  }
  const cells: Array<[string, number]> = [
    ['Days', d],
    ['Hours', h],
    ['Minutes', m],
    ['Seconds', s],
  ];
  return (
    <div className={className} aria-label={`Launching ${LAUNCH_DATE_LABEL}`}>
      <div className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-primary font-bold mb-3 text-center">
        Doors open · {LAUNCH_DATE_LABEL}
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {cells.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl bg-background/70 backdrop-blur-md border border-primary/15 px-1 py-2 sm:py-3 text-center shadow-sm"
          >
            <div className="text-xl sm:text-3xl font-black tabular-nums text-foreground leading-none">
              {pad(value)}
            </div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
