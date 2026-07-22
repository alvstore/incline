import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, User, Shield, AlertTriangle, RefreshCw, Eye, DoorOpen, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { remoteOpenDoorByBranch } from "@/services/mipsService";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AccessLogEntry {
  id: string;
  device_sn: string;
  event_type: string;
  result: string | null;
  message: string | null;
  member_id: string | null;
  profile_id: string | null;
  branch_id: string | null;
  payload: Record<string, unknown> | null;
  captured_at: string | null;
  created_at: string;
  members?: {
    id: string;
    member_code: string;
    biometric_photo_url: string | null;
    profiles: { full_name: string; avatar_url: string | null } | null;
    memberships: Array<{ status: string; end_date: string; membership_plans: { name: string } | null }>;
  } | null;
}

interface DedupedEntry extends AccessLogEntry {
  count: number;
}

interface LiveAccessLogProps {
  branchId?: string;
  limit?: number;
}

const resultConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  member: { color: "bg-success", icon: <User className="h-3 w-3" />, label: "Member" },
  staff: { color: "bg-info", icon: <Shield className="h-3 w-3" />, label: "Staff" },
  stranger: { color: "bg-warning", icon: <AlertTriangle className="h-3 w-3" />, label: "Stranger" },
  not_found: { color: "bg-destructive", icon: <AlertTriangle className="h-3 w-3" />, label: "Not Found" },
  member_denied: { color: "bg-destructive", icon: <User className="h-3 w-3" />, label: "Denied" },
  ignored: { color: "bg-muted-foreground", icon: <Activity className="h-3 w-3" />, label: "Ignored" },
  accepted: { color: "bg-success", icon: <Activity className="h-3 w-3" />, label: "Accepted" },
};

function getBillingBadge(memberships: Array<{ status: string; end_date: string }> | undefined) {
  if (!memberships?.length) return null;
  const active = memberships.find(m => m.status === "active");
  if (!active) {
    const frozen = memberships.find(m => m.status === "frozen");
    if (frozen) return <Badge variant="outline" className="text-[10px] bg-info/10 text-info border-info/20">Frozen</Badge>;
    return <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">No Active Plan</Badge>;
  }
  const daysLeft = differenceInDays(new Date(active.end_date), new Date());
  if (daysLeft < 0) return <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">Overdue</Badge>;
  if (daysLeft <= 7) return <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/20">Due in {daysLeft}d</Badge>;
  return <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20">{daysLeft}d left</Badge>;
}

/** Dedup: collapse same member_id + result within 60s into one entry */
function deduplicateEvents(events: AccessLogEntry[]): DedupedEntry[] {
  const result: DedupedEntry[] = [];
  const seen = new Map<string, number>(); // key -> index in result

  for (const event of events) {
    const key = `${event.member_id || event.id}_${event.result}`;
    const existingIdx = seen.get(key);

    if (existingIdx !== undefined) {
      const existing = result[existingIdx];
      const timeDiff = Math.abs(
        new Date(event.created_at).getTime() - new Date(existing.created_at).getTime()
      );
      if (timeDiff < 60_000) {
        existing.count += 1;
        continue;
      }
    }

    seen.set(key, result.length);
    result.push({ ...event, count: 1 });
  }
  return result;
}

const LiveAccessLog = ({ branchId, limit = 20 }: LiveAccessLogProps) => {
  const queryClient = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<AccessLogEntry[]>([]);
  const [expandedPayload, setExpandedPayload] = useState<string | null>(null);
  const [openingDoor, setOpeningDoor] = useState(false);

  const { data: initialEvents = [], isLoading } = useQuery({
    queryKey: ["access-logs-live", branchId, limit],
    queryFn: async () => {
      let query = supabase
        .from("access_logs")
        .select(`*, members:member_id(id, member_code, biometric_photo_url, profiles:user_id(full_name, avatar_url), memberships(status, end_date, membership_plans(name)))`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (branchId) query = query.eq("branch_id", branchId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as AccessLogEntry[];
    },
  });

  useEffect(() => {
    setLiveEvents(initialEvents);
  }, [initialEvents]);

  const [rtStatus, setRtStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  useEffect(() => {
    const channel = supabase
      .channel("access-logs-realtime-" + (branchId || "all"))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "access_logs",
          ...(branchId ? { filter: `branch_id=eq.${branchId}` } : {}),
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["access-logs-live", branchId, limit] });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRtStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRtStatus('error');
        else setRtStatus('connecting');
      });

    return () => { supabase.removeChannel(channel); };
  }, [branchId, limit, queryClient]);


  const dedupedEvents = useMemo(() => deduplicateEvents(liveEvents), [liveEvents]);

  const handleManualOverride = async () => {
    if (!branchId) { toast.error("No branch selected"); return; }
    setOpeningDoor(true);
    try {
      const result = await remoteOpenDoorByBranch(branchId);
      if (result.success) toast.success("Door opened!");
      else toast.error(result.message);
    } finally {
      setOpeningDoor(false);
    }
  };

  const checkOutMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await supabase.rpc('member_check_out', { _member_id: memberId });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(`Checked out — ${Math.round(data.duration_minutes || 0)} min session`);
        queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
      } else {
        toast.info(data?.message || "No active check-in found");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const staffCheckOutMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const today = new Date().toISOString().split('T')[0];
      const { data: existing, error: fetchErr } = await (supabase
        .from('staff_attendance') as any)
        .select('id, check_out')
        .eq('user_id', profileId)
        .eq('date', today)
        .is('check_out', null)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) throw new Error('No active check-in found');
      const { error: updateErr } = await (supabase
        .from('staff_attendance') as any)
        .update({ check_out: new Date().toISOString() })
        .eq('id', existing.id);
      if (updateErr) throw updateErr;
    },
    onSuccess: () => {
      toast.success("Staff checked out");
      queryClient.invalidateQueries({ queryKey: ["access-logs-live"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const getConfig = (result: string | null) => resultConfig[result || ""] || resultConfig.ignored;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Live Access Feed</CardTitle>
          <div className="flex items-center gap-2">
            {branchId && (
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleManualOverride} disabled={openingDoor}>
                <DoorOpen className="h-3.5 w-3.5" />
                {openingDoor ? "Opening..." : "Override"}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => queryClient.invalidateQueries({ queryKey: ["access-logs-live"] })}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[420px] pr-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dedupedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">No access events yet</p>
              <p className="text-xs mt-1">Events will appear here in real-time</p>
            </div>
          ) : (
            <div className="relative ml-4">
              <div className="absolute left-[7px] top-3 bottom-3 w-0.5 bg-border" />
              <div className="space-y-3">
                {dedupedEvents.map((event) => {
                  const config = getConfig(event.result);
                  const memberData = event.members;
                  const memberPhoto = memberData?.biometric_photo_url || memberData?.profiles?.avatar_url;
                  const memberName = memberData?.profiles?.full_name;
                  const billingBadge = getBillingBadge(memberData?.memberships);
                  const isDenied = event.result === "member_denied" || event.result === "not_found" || event.result === "stranger";
                  const isSuccessfulEntry = event.result === "member" || event.result === "accepted";
                  const isStaffEntry = event.result === "staff";

                  return (
                    <div key={event.id} className="relative pl-6">
                      <div className="flex items-start gap-3">
                        <div className={`absolute left-0 top-2 w-[15px] h-[15px] rounded-full border-2 border-background z-10 ${config.color}`} />

                        <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border">
                          {memberPhoto ? (
                            <AvatarImage src={memberPhoto} alt={memberName || ""} />
                          ) : null}
                          <AvatarFallback className="text-xs bg-muted">
                            {memberName ? memberName.charAt(0).toUpperCase() : config.icon}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {memberName && (
                              <span className="text-xs font-semibold">{memberName}</span>
                            )}
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                isSuccessfulEntry || isStaffEntry
                                  ? "bg-success/10 text-success border-success/20"
                                  : isDenied
                                  ? "bg-destructive/10 text-destructive border-destructive/20"
                                  : "bg-muted"
                              }`}
                            >
                              {config.label}
                            </Badge>
                            {event.count > 1 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                ×{event.count}
                              </Badge>
                            )}
                            {billingBadge}
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {event.device_sn}
                            </span>
                          </div>
                          <p className="text-xs mt-0.5 truncate">{event.message || "—"}</p>

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 mt-1">
                            {isDenied && branchId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-warning hover:text-warning gap-1"
                                onClick={handleManualOverride}
                                disabled={openingDoor}
                              >
                                <DoorOpen className="h-3 w-3" />
                                Override
                              </Button>
                            )}
                            {isSuccessfulEntry && event.member_id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                                onClick={() => checkOutMutation.mutate(event.member_id!)}
                                disabled={checkOutMutation.isPending}
                              >
                                <LogOut className="h-3 w-3" />
                                Check Out
                              </Button>
                            )}
                            {isStaffEntry && event.profile_id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                                onClick={() => staffCheckOutMutation.mutate(event.profile_id!)}
                                disabled={staffCheckOutMutation.isPending}
                              >
                                <LogOut className="h-3 w-3" />
                                Check Out
                              </Button>
                            )}
                          </div>

                          {event.payload && (
                            <Collapsible
                              open={expandedPayload === event.id}
                              onOpenChange={(open) => setExpandedPayload(open ? event.id : null)}
                            >
                              <CollapsibleTrigger asChild>
                                <button className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-0.5">
                                  <Eye className="h-3 w-3" />
                                  Payload
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <pre className="text-[10px] bg-muted rounded p-2 mt-1 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                                  {JSON.stringify(event.payload, null, 2)}
                                </pre>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </div>

                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                          {event.captured_at || event.created_at
                            ? formatDistanceToNow(new Date(event.captured_at || event.created_at), { addSuffix: true })
                            : "Just now"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default LiveAccessLog;
