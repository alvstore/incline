import { useEffect, useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useIgPendingApprovals, useReviewIgRun,
} from "@/services/igAutomationService";
import { formatDistanceToNow } from "date-fns";
import {
  ShieldCheck, ShieldAlert, Send, X, UserPlus, ExternalLink, Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
}

const REJECT_REASONS = ["Off-topic", "Spam / bot", "Duplicate", "Other"] as const;

export function IgApprovalQueueDrawer({
  open, onOpenChange, branchId, campaignId, campaignName,
}: Props) {
  const { data: runs = [], isLoading } = useIgPendingApprovals(
    open ? branchId : null,
    campaignId ?? null,
  );
  const review = useReviewIgRun();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full overflow-y-auto p-0">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600 ring-1 ring-amber-100">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-bold text-slate-900">
                Awaiting human review
                {campaignName ? ` · ${campaignName}` : ""}
              </SheetTitle>
              <SheetDescription className="text-xs text-slate-500">
                These Instagram DMs are paused until you approve or reject them. Edit the text before sending if needed.
              </SheetDescription>
            </div>
            <Badge className="rounded-full bg-amber-100 text-amber-700">
              {runs.length}
            </Badge>
          </div>
        </SheetHeader>

        <div className="space-y-3 px-6 py-5">
          {isLoading ? (
            <SkeletonList />
          ) : runs.length === 0 ? (
            <EmptyState />
          ) : (
            runs.map((r) => (
              <ReviewCard
                key={r.id}
                run={r}
                busy={review.isPending}
                onSubmit={async (decision, edited_body, notes) => {
                  try {
                    await review.mutateAsync({ id: r.id, decision, edited_body, notes });
                    toast.success(
                      decision === "approved"
                        ? "Approved — DM will go out within a minute"
                        : "Rejected — no DM will be sent",
                    );
                  } catch (e: any) {
                    toast.error(e.message ?? "Review failed");
                  }
                }}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReviewCard({
  run, busy, onSubmit,
}: {
  run: any;
  busy: boolean;
  onSubmit: (decision: "approved" | "rejected", edited_body: string | null, notes: string | null) => Promise<void>;
}) {
  const initial = (run.dm_draft ?? "").toString();
  const [body, setBody] = useState(initial);
  const [rejecting, setRejecting] = useState(false);
  const [reasonChip, setReasonChip] = useState<string>("");
  const [notes, setNotes] = useState("");
  useEffect(() => { setBody(initial); }, [initial]);

  const isEdited = body.trim() !== initial.trim();
  const campaign = run.ig_comment_campaigns;
  const charCount = body.length;
  const ageLabel = useMemo(
    () => formatDistanceToNow(new Date(run.created_at), { addSuffix: true }),
    [run.created_at],
  );

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm shadow-slate-200/60 ring-1 ring-slate-100 transition-shadow hover:shadow-md">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge className="rounded-full bg-indigo-50 text-indigo-700">{campaign?.name ?? "Campaign"}</Badge>
        <span className="text-slate-700 font-medium truncate max-w-[160px]">
          @{run.ig_username || run.ig_user_id}
        </span>
        {run.matched_keyword && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
            kw: {run.matched_keyword}
          </span>
        )}
        <span className="ml-auto text-slate-400">{ageLabel}</span>
      </div>

      {/* Comment quote */}
      {run.comment_text && (
        <blockquote className="mt-3 rounded-lg border-l-2 border-indigo-200 bg-slate-50/70 px-3 py-2 text-xs italic text-slate-600">
          "{run.comment_text}"
        </blockquote>
      )}

      {/* Editable DM */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            DM to send
          </label>
          <span className={`text-[11px] tabular-nums ${charCount > 950 ? "text-red-600" : "text-slate-400"}`}>
            {charCount} / 1000
          </span>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={1000}
          className="resize-none rounded-xl border-slate-200 text-sm"
          placeholder="DM body…"
        />
        {isEdited && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-indigo-600">
            <Sparkles className="h-3 w-3" /> Edited — your changes will be sent
          </p>
        )}
      </div>

      {/* Reject panel */}
      {rejecting && (
        <div className="mt-3 rounded-xl bg-red-50/60 p-3 ring-1 ring-red-100">
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReasonChip(r)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors ${
                  reasonChip === r
                    ? "bg-red-600 text-white ring-red-600"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-red-100"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional note for the audit log…"
            className="mt-2 resize-none rounded-lg border-red-100 text-xs"
          />
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {run.lead_id && (
          <Link
            to={`/leads/${run.lead_id}`}
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            <UserPlus className="h-3 w-3" /> Lead
          </Link>
        )}
        {campaign?.ig_media_permalink && (
          <a
            href={campaign.ig_media_permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Post
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {rejecting ? (
            <>
              <Button
                size="sm" variant="ghost"
                onClick={() => { setRejecting(false); setReasonChip(""); setNotes(""); }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={busy}
                onClick={() => {
                  const finalNotes = [reasonChip, notes.trim()].filter(Boolean).join(" — ");
                  onSubmit("rejected", null, finalNotes || null);
                }}
              >
                Confirm reject
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm" variant="outline"
                className="rounded-lg border-slate-200 hover:bg-red-50 hover:text-red-600"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                <X className="h-4 w-4 mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                className="rounded-lg bg-emerald-600 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-700"
                disabled={busy || !body.trim()}
                onClick={() => onSubmit("approved", isEdited ? body : null, null)}
              >
                <Send className="h-4 w-4 mr-1" />
                {isEdited ? "Approve with edits" : "Approve & Send"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl bg-white p-4 ring-1 ring-slate-100">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          <Skeleton className="mt-3 h-12 w-full rounded-lg" />
          <Skeleton className="mt-3 h-20 w-full rounded-xl" />
          <div className="mt-3 flex justify-end gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-36 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-slate-900">All caught up</p>
      <p className="mt-1 text-xs text-slate-500">
        No Instagram DMs waiting for review right now.
      </p>
    </div>
  );
}
