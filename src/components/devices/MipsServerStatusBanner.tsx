import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, PauseCircle, ServerCog } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useMipsFleet } from "./useMipsFleet";

interface Props {
  branchId?: string;
}

interface BreakerValue {
  open?: boolean;
  open_until?: string | null;
  consecutive_failures?: number;
  last_error?: string | null;
  last_failure_at?: string | null;
  last_success_at?: string | null;
}

/**
 * Server-health strip for the Device Command Center.
 *
 * The sync workers write their transport state into `settings.mips_breaker`
 * whenever the MIPS server becomes unreachable. This surfaces that state so an
 * outage reads as an outage ("paused, auto-resuming") instead of looking like
 * silent failure.
 */
const MipsServerStatusBanner = ({ branchId }: Props) => {
  const { isConnected, connection, isLoading: fleetLoading } = useMipsFleet(branchId);

  const breakerQuery = useQuery({
    queryKey: ["mips-breaker", branchId || "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("branch_id, value")
        .eq("key", "mips_breaker");
      if (error) throw error;
      const rows = (data || []) as Array<{ branch_id: string | null; value: BreakerValue }>;
      const scoped = branchId ? rows.filter((r) => r.branch_id === branchId || r.branch_id === null) : rows;
      // Worst state wins so a single unreachable branch is never hidden.
      return scoped.reduce<BreakerValue | null>((worst, r) => {
        const v = r.value || {};
        if (!worst) return v;
        return v.open && !worst.open ? v : worst;
      }, null);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (fleetLoading || breakerQuery.isLoading) {
    return <Skeleton className="h-[74px] rounded-2xl" />;
  }

  const breaker = breakerQuery.data;
  const openUntil = breaker?.open_until ? new Date(breaker.open_until) : null;
  const paused = Boolean(breaker?.open) && (!openUntil || openUntil.getTime() > Date.now());
  const degraded = !paused && (breaker?.consecutive_failures ?? 0) > 0;
  const authFailed = !isConnected && connection?.reason === "auth_failed";

  const state: "paused" | "degraded" | "down" | "auth" | "healthy" = authFailed
    ? "auth"
    : paused
      ? "paused"
      : !isConnected
        ? "down"
        : degraded
          ? "degraded"
          : "healthy";

  const config = {
    auth: {
      icon: <KeyRound className="h-5 w-5" aria-hidden="true" />,
      badge: "Credentials rejected",
      badgeClass: "bg-red-100 text-red-700",
      iconClass: "bg-red-50 text-red-600",
      title: "MIPS server reachable — but the login was rejected",
      detail:
        "The server answered, so this is not a network outage. The stored MIPS username/password is wrong or was changed on the server. Open Device Setup (gear icon) and re-enter the credentials to restore sync.",
    },
    paused: {
      icon: <PauseCircle className="h-5 w-5" aria-hidden="true" />,
      badge: "Sync paused",
      badgeClass: "bg-amber-100 text-amber-700",
      iconClass: "bg-amber-50 text-amber-600",
      title: "MIPS server unreachable — sync paused, auto-resuming",
      detail: openUntil
        ? `Next automatic retry ${formatDistanceToNow(openUntil, { addSuffix: true })}. Nothing is lost: queued people resume without consuming their retry budget.`
        : "Workers will probe the server on the next tick.",
    },
    down: {
      icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
      badge: "Unreachable",
      badgeClass: "bg-red-100 text-red-700",
      iconClass: "bg-red-50 text-red-600",
      title: "MIPS server is not responding",
      detail: connection?.message || "The Device Command Center cannot reach the access-control server.",
    },
    degraded: {
      icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
      badge: "Degraded",
      badgeClass: "bg-amber-100 text-amber-700",
      iconClass: "bg-amber-50 text-amber-600",
      title: "Intermittent MIPS connectivity",
      detail: `${breaker?.consecutive_failures} consecutive transport failure(s). Sync continues with backoff.`,
    },

    healthy: {
      icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
      badge: "Healthy",
      badgeClass: "bg-emerald-100 text-emerald-700",
      iconClass: "bg-emerald-50 text-emerald-600",
      title: "MIPS server reachable — sync running",
      detail: breaker?.last_success_at
        ? `Last successful contact ${formatDistanceToNow(new Date(breaker.last_success_at), { addSuffix: true })}.`
        : "Workers are dispatching people and faces normally.",
    },
  }[state];

  return (
    <Card className="rounded-2xl border-none shadow-lg shadow-muted/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardContent className="flex flex-wrap items-start gap-3 p-4">
        <div className={`rounded-full p-2.5 ${config.iconClass}`}>{config.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{config.title}</p>
            <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${config.badgeClass}`} variant="secondary">
              {config.badge}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{config.detail}</p>
          {breaker?.last_error && state !== "healthy" && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={breaker.last_error}>
              <ServerCog className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {breaker.last_error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default MipsServerStatusBanner;
