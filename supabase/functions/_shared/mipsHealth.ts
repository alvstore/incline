// v1.0.0 — MIPS transport health: failure classification + shared circuit breaker.
//
// Why: the MIPS server lives on a single VPS that can reboot, restart Tomcat or
// go briefly unreachable. Before this module every worker treated "server is
// booting" exactly like "this person's data is invalid": rows burned their
// retry budget, the sweep hammered a starting server, and the UI showed silent
// failure instead of an outage.
//
// Breaker state is stored once in `settings` (branch-scoped) so every worker
// shares one view rather than each edge invocation deciding alone.

export type MipsFailureKind = "transport" | "data";

export const BREAKER_KEY = "mips_breaker";

/** Consecutive transport failures before the breaker opens. */
const TRIP_AFTER = 3;
/** Cooldown ladder in minutes for successive opens. */
const COOLDOWN_MIN = [2, 5, 10, 20, 30];

export interface BreakerState {
  open: boolean;
  /** ISO timestamp the breaker may be probed again. */
  open_until: string | null;
  consecutive_failures: number;
  opens: number;
  last_error: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
}

const EMPTY: BreakerState = {
  open: false,
  open_until: null,
  consecutive_failures: 0,
  opens: 0,
  last_error: null,
  last_failure_at: null,
  last_success_at: null,
};

/**
 * Transport = the server could not be reached or did not answer in time.
 * Data = the server answered and rejected the request (validation, auth, business rule).
 * Only transport failures should back off and trip the breaker.
 */
export function classifyFailure(input: { status?: number | null; message?: string | null }): MipsFailureKind {
  const status = input.status ?? null;
  if (status !== null) {
    // 408 request timeout, 425 too early, 429 overloaded, 5xx server/gateway.
    if (status === 408 || status === 425 || status === 429 || status >= 500) return "transport";
    return "data";
  }
  const msg = (input.message || "").toLowerCase();
  const transportMarkers = [
    "timed out",
    "timeout",
    "aborted",
    "abort",
    "connection refused",
    "connection reset",
    "econnrefused",
    "econnreset",
    "ehostunreach",
    "enetunreach",
    "network",
    "dns",
    "error sending request",
    "connection closed",
    "socket",
    "non-json", // a booting Tomcat serves an HTML error page
    "502",
    "503",
    "504",
    "bad gateway",
    "gateway time",
    "service unavailable",
  ];
  return transportMarkers.some((m) => msg.includes(m)) ? "transport" : "data";
}

export class MipsTransportError extends Error {
  readonly kind: MipsFailureKind = "transport";
  constructor(message: string) {
    super(message);
    this.name = "MipsTransportError";
  }
}

/**
 * fetch with a hard timeout that always reports unreachable-ness as a
 * MipsTransportError, so no call can hang until the invocation budget dies.
 */
export async function mipsFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<{ res: Response; text: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      throw new MipsTransportError(`MIPS HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
    return { res, text };
  } catch (e) {
    if (e instanceof MipsTransportError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (classifyFailure({ message: msg }) === "transport") {
      throw new MipsTransportError(`MIPS unreachable (${url.split("/").slice(0, 3).join("/")}): ${msg}`);
    }
    throw e;
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function readBreaker(supabase: Db, branchId: string | null): Promise<BreakerState> {
  const q = supabase.from("settings").select("value").eq("key", BREAKER_KEY);
  const { data } = branchId
    ? await q.eq("branch_id", branchId).maybeSingle()
    : await q.is("branch_id", null).maybeSingle();
  const value = (data?.value ?? {}) as Partial<BreakerState>;
  return { ...EMPTY, ...value };
}

async function writeBreaker(supabase: Db, branchId: string | null, state: BreakerState) {
  await supabase
    .from("settings")
    .upsert(
      {
        branch_id: branchId,
        key: BREAKER_KEY,
        value: state,
        description: "MIPS transport circuit breaker (auto-managed by sync workers)",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_id,key" },
    );
}

/**
 * True when the breaker is holding traffic back. A breaker whose cooldown has
 * elapsed reports false (half-open): the next call is the probe.
 */
export function isTripped(state: BreakerState, now = Date.now()): boolean {
  if (!state.open) return false;
  if (!state.open_until) return true;
  return new Date(state.open_until).getTime() > now;
}

export async function recordTransportFailure(
  supabase: Db,
  branchId: string | null,
  message: string,
): Promise<BreakerState> {
  const prev = await readBreaker(supabase, branchId);
  const failures = (prev.consecutive_failures || 0) + 1;
  const shouldOpen = failures >= TRIP_AFTER;
  const opens = shouldOpen ? (prev.opens || 0) + 1 : prev.opens || 0;
  const cooldown = COOLDOWN_MIN[Math.min(Math.max(opens - 1, 0), COOLDOWN_MIN.length - 1)];
  const next: BreakerState = {
    ...prev,
    open: shouldOpen,
    open_until: shouldOpen ? new Date(Date.now() + cooldown * 60_000).toISOString() : prev.open_until,
    consecutive_failures: failures,
    opens,
    last_error: message.slice(0, 300),
    last_failure_at: new Date().toISOString(),
  };
  await writeBreaker(supabase, branchId, next);
  return next;
}

export async function recordSuccess(supabase: Db, branchId: string | null): Promise<void> {
  const prev = await readBreaker(supabase, branchId);
  if (!prev.open && (prev.consecutive_failures || 0) === 0 && prev.last_success_at) {
    // Nothing to reset — avoid a write on every healthy tick.
    const age = Date.now() - new Date(prev.last_success_at).getTime();
    if (age < 60_000) return;
  }
  await writeBreaker(supabase, branchId, {
    ...prev,
    open: false,
    open_until: null,
    consecutive_failures: 0,
    opens: 0,
    last_error: null,
    last_success_at: new Date().toISOString(),
  });
}
