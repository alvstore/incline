// v1.0.0 — canonical MIPS hardware timestamp parser.
//
// The same physical face scan can reach us through two paths:
//   1. `mips-webhook-receiver`  (terminal pushes the event)
//   2. `reconcile-mips-pass-records` (cron pulls /through/record/list)
//
// Both MUST derive the SAME instant for the same raw value, otherwise the two
// paths disagree about when someone arrived and lateness is computed twice with
// different answers. This module is the only place that decision is made.
//
// Rules:
//   - Numeric values are epoch values; the magnitude decides the unit
//     (ns / µs / ms / s).
//   - A *naive* wall-clock string ("2026-08-29 16:57:00" / "2026-08-29T16:57:00")
//     carries no zone. MIPS terminals are configured to local Indian time, so it
//     is interpreted as IST (+05:30). Interpreting it as UTC — which the webhook
//     used to do — shifted every punch by 5h30m.
//   - Strings that already carry an offset or a trailing Z are honoured as-is.
//   - Only when nothing parseable is supplied do we fall back to "now" (webhook
//     arrival time), and callers should treat that as a degraded reading.

export interface ScanTime {
  /** UTC ISO-8601 instant of the hardware scan. */
  iso: string;
  /** false when we had to fall back to arrival time (no usable payload value). */
  fromHardware: boolean;
}

const NAIVE_LOCAL = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export function parseScanTime(rawTime: unknown): ScanTime {
  const fallback = { iso: new Date().toISOString(), fromHardware: false };
  if (rawTime === null || rawTime === undefined || rawTime === "") return fallback;

  // Epoch numbers (also accepts numeric strings).
  const asNumber = typeof rawTime === "number" ? rawTime : Number(String(rawTime).trim());
  if (Number.isFinite(asNumber) && String(rawTime).trim() !== "" && !/[-:T ]/.test(String(rawTime).trim())) {
    const abs = Math.abs(asNumber);
    let ms: number;
    if (abs >= 1e18) ms = asNumber / 1e6; // nanoseconds
    else if (abs >= 1e15) ms = asNumber / 1e3; // microseconds
    else if (abs >= 1e12) ms = asNumber; // milliseconds
    else ms = asNumber * 1e3; // seconds

    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), fromHardware: true };
  }

  if (typeof rawTime === "string") {
    const trimmed = rawTime.trim();

    // Naive wall clock => IST, the terminal's configured zone.
    if (NAIVE_LOCAL.test(trimmed)) {
      const d = new Date(`${trimmed.replace(" ", "T")}+05:30`);
      if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), fromHardware: true };
    }

    // Explicit offset / Z, or anything else Date can read.
    const d = new Date(HAS_ZONE.test(trimmed) ? trimmed : trimmed.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) return { iso: d.toISOString(), fromHardware: true };
  }

  return fallback;
}

/** Convenience wrapper for call sites that only need the ISO instant. */
export function normalizeScanTime(rawTime: unknown): string {
  return parseScanTime(rawTime).iso;
}

/**
 * Deterministic key for one hardware event, so the webhook and the
 * reconciliation cron can recognise the same scan and stay idempotent.
 */
export function hardwareEventKey(deviceSn: string, personNo: string, scanIso: string): string {
  return `${deviceSn}|${personNo}|${scanIso}`;
}
