// Report-only stage of the Content Security Policy rollout.
// A <meta> CSP cannot be report-only, so instead we watch every resource the
// page loads and report origins that are not on the planned allowlist to
// System Health (once per origin per session). Nothing is blocked.
import { supabase } from "@/integrations/supabase/client";
import { isAllowedOrigin } from "./originAllowlist";

export function startOriginAudit() {
  if (typeof PerformanceObserver === "undefined") return;
  const seen = new Set<string>();
  const check = (name: string, type: string) => {
    let origin = "";
    try {
      const u = new URL(name);
      if (u.protocol === "data:" || u.protocol === "blob:") return;
      origin = u.origin;
    } catch { return; }
    if (seen.has(origin) || isAllowedOrigin(origin)) return;
    seen.add(origin);
    (supabase.rpc as any)("log_error_event", {
      p_severity: "warning",
      p_source: "frontend",
      p_message: `CSP report-only: unlisted origin ${origin}`,
      p_route: location.pathname,
      p_context: { origin, initiator: type, stage: "csp_report_only" },
    }).then(() => {}, () => {});
  };
  try {
    performance.getEntriesByType("resource").forEach((e) => check(e.name, (e as PerformanceResourceTiming).initiatorType));
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => check(e.name, (e as PerformanceResourceTiming).initiatorType));
    }).observe({ type: "resource", buffered: true });
  } catch { /* unsupported */ }
}
