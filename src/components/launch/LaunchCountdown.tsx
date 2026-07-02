import { useEffect, useState } from "react";
import {
  formatCountdown,
  msUntilLaunch,
  LAUNCH_LABEL_SHORT,
  pad2,
  type Countdown,
} from "@/lib/launch";

/**
 * Shared countdown state — one interval per mount, paused when tab is hidden,
 * respects prefers-reduced-motion (ticks per-minute instead of per-second).
 */
function useCountdown(): Countdown {
  const [state, setState] = useState<Countdown>(() =>
    formatCountdown(msUntilLaunch()),
  );

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const intervalMs = reduced ? 60_000 : 1_000;

    let timer: number | null = null;
    const tick = () => setState(formatCountdown(msUntilLaunch()));

    const start = () => {
      if (timer !== null) return;
      tick();
      timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
}

interface Props {
  variant?: "inline" | "chip" | "line";
  className?: string;
}

/**
 * Presentational countdown used in the hero, the floating chip, and the
 * final CTA. All variants collapse gracefully to a static label after launch.
 */
const LaunchCountdown = ({ variant = "inline", className = "" }: Props) => {
  const c = useCountdown();

  if (c.past) {
    // Post-launch: never render negative numbers.
    if (variant === "chip") {
      return (
        <span className={className}>We're open · {LAUNCH_LABEL_SHORT}</span>
      );
    }
    return (
      <span className={className}>
        WE ARE OPEN · {LAUNCH_LABEL_SHORT.toUpperCase()}
      </span>
    );
  }

  if (variant === "chip") {
    // Compact copy for the floating pill.
    const label =
      c.d > 0
        ? `Launching in ${c.d} day${c.d === 1 ? "" : "s"}`
        : `Launching in ${pad2(c.h)}h ${pad2(c.m)}m`;
    return <span className={className}>{label}</span>;
  }

  if (variant === "line") {
    return (
      <span className={className}>
        {c.d}d · {pad2(c.h)}h · {pad2(c.m)}m to {LAUNCH_LABEL_SHORT}
      </span>
    );
  }

  // "inline" — the hero scroll indicator. Two lines, same slot as the
  // original "BEGIN YOUR ASCENT • 2026" text.
  return (
    <span
      className={`flex flex-col items-center gap-1 ${className}`}
      aria-label={`Launching on ${LAUNCH_LABEL_SHORT} — ${c.d} days ${c.h} hours ${c.m} minutes ${c.s} seconds remaining`}
    >
      <span className="text-sm tracking-widest uppercase font-bold text-primary animate-pulse">
        BEGIN YOUR ASCENT · {LAUNCH_LABEL_SHORT.toUpperCase()}
      </span>
      <span
        className="font-mono text-xs md:text-sm tracking-[0.2em] text-primary/90 tabular-nums"
        aria-hidden="true"
      >
        {c.d}d : {pad2(c.h)}h : {pad2(c.m)}m : {pad2(c.s)}s
      </span>
    </span>
  );
};

export default LaunchCountdown;
