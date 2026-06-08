import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIgCampaignRuns, useRetryIgRun } from "@/services/igAutomationService";
import type { IgCommentCampaign, IgRunStatus } from "@/types/igAutomations";
import { format } from "date-fns";
import { RefreshCw, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaign: IgCommentCampaign | null;
}

const STATUS_STYLE: Record<IgRunStatus, string> = {
  sent: "bg-success/15 text-success",
  pending: "bg-muted text-muted-foreground",
  scheduled: "bg-info/15 text-info",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-warning/15 text-warning",
  awaiting_review: "bg-warning/15 text-warning",
};

export function IgRunsLogDrawer({ open, onOpenChange, campaign }: Props) {
  const { data: runs = [], isLoading } = useIgCampaignRuns(campaign?.id ?? null);
  const retry = useRetryIgRun();
  const onRetry = async (id: string) => {
    try {
      await retry.mutateAsync({ id, campaign_id: campaign!.id });
      toast.success("Re-queued — executor will pick it up within a minute");
    } catch (e: any) { toast.error(e.message ?? "Retry failed"); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full">
        <SheetHeader>
          <SheetTitle>{campaign?.name ?? "Campaign"} — Run log</SheetTitle>
          <SheetDescription>
            Latest 200 events: matched comments, DMs sent, failures, and skips.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2 overflow-y-auto max-h-[calc(100vh-140px)]">
          {isLoading ? (
            <div className="text-center text-sm text-muted-foreground py-10">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">No events yet.</div>
          ) : runs.map((r) => (
            <div key={r.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={`${STATUS_STYLE[r.status]} rounded-full px-2.5`}>{r.status}</Badge>
                  <Badge variant="outline" className="rounded-full">{r.action}</Badge>
                  <span className="text-foreground truncate">
                    {r.ig_username || r.ig_user_id}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(r.status === "failed" || r.status === "skipped") && (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2 text-xs"
                      onClick={() => onRetry(r.id)} disabled={retry.isPending}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> Retry
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(r.created_at), "dd MMM HH:mm:ss")}
                  </span>
                </div>
              </div>
              {r.comment_text && (
                <div className="text-xs text-muted-foreground mt-1 italic line-clamp-2">"{r.comment_text}"</div>
              )}
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                {r.matched_keyword && <span>kw: <code>{r.matched_keyword}</code></span>}
                {r.attempts > 0 && <span>attempts: {r.attempts}</span>}
                {r.skip_reason && <span className="text-warning">skip: {r.skip_reason}</span>}
                {r.error_message && <span className="text-destructive">error: {r.error_message}</span>}
                {r.lead_id && (
                  <Link
                    to={`/leads/${r.lead_id}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <UserPlus className="h-3 w-3" /> View lead
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
