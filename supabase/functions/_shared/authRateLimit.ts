// v1.0.0 — Attempt limits for sign-in / password reset via hit_public_form_rate_limit.
// Fails open (logged) so a limiter outage never locks members out.
export type LimitRule = { key: string; limit: number; windowSeconds: number };

export async function sha256Hex(v: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

/** Returns null when allowed, or retry-after seconds when any rule is exceeded. */
export async function checkLimits(rpc: Rpc, rules: LimitRule[], source: string): Promise<number | null> {
  let retry: number | null = null;
  for (const r of rules) {
    try {
      const { data, error } = await rpc("hit_public_form_rate_limit", {
        p_key: `${source}:${await sha256Hex(r.key)}`, p_limit: r.limit, p_window_seconds: r.windowSeconds,
      });
      if (error) {
        await rpc("log_error_event", { p_severity: "warning", p_source: "edge_function",
          p_message: `${source} rate limiter unavailable`, p_function_name: source }).then(() => {}, () => {});
        continue;
      }
      if (data === false) retry = Math.max(retry ?? 0, r.windowSeconds);
    } catch { /* fail open */ }
  }
  return retry;
}
