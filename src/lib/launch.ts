/**
 * Single source of truth for the public launch moment.
 * Matches the SSOT already used across ai-agent-brain.ts, public/llms*.txt,
 * ai_knowledge (launch_timeline), and index.html JSON-LD.
 *
 * Sunday, 26 July 2026 · 00:00 IST (Asia/Kolkata, UTC+05:30).
 */
export const LAUNCH_ISO = "2026-07-26T00:00:00+05:30";
export const LAUNCH_TIMESTAMP = Date.parse(LAUNCH_ISO);
export const LAUNCH_LABEL_SHORT = "Sun 26 Jul 2026";
export const LAUNCH_LABEL_LONG = "Sunday, 26 July 2026";

export interface Countdown {
  d: number;
  h: number;
  m: number;
  s: number;
  totalMs: number;
  past: boolean;
}

export function msUntilLaunch(now: number = Date.now()): number {
  return LAUNCH_TIMESTAMP - now;
}

export function formatCountdown(ms: number): Countdown {
  if (ms <= 0) {
    return { d: 0, h: 0, m: 0, s: 0, totalMs: 0, past: true };
  }
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { d, h, m, s, totalMs: ms, past: false };
}

export const pad2 = (n: number): string => n.toString().padStart(2, "0");
