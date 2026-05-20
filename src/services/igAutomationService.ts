import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { IgCampaignUpsert, IgCommentCampaign, IgCommentRun } from "@/types/igAutomations";

const TABLE = "ig_comment_campaigns" as const;
const RUNS = "ig_comment_runs" as const;

export function useIgCampaigns(branchId: string | null) {
  return useQuery({
    queryKey: ["ig-campaigns", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select("*")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as IgCommentCampaign[];
    },
  });
}

export function useIgCampaignRuns(campaignId: string | null) {
  return useQuery({
    queryKey: ["ig-runs", campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(RUNS)
        .select("*")
        .eq("campaign_id", campaignId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as IgCommentRun[];
    },
  });
}

export function useUpsertIgCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: IgCampaignUpsert & { id?: string }) => {
      const payload: any = { ...input };
      // normalize keywords
      payload.keywords = (payload.keywords || [])
        .map((k: string) => String(k).trim())
        .filter(Boolean);
      const { data, error } = input.id
        ? await (supabase as any).from(TABLE).update(payload).eq("id", input.id).select("*").single()
        : await (supabase as any).from(TABLE).insert(payload).select("*").single();
      if (error) throw error;
      return data as IgCommentCampaign;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["ig-campaigns", row.branch_id] });
    },
  });
}

export function useToggleIgCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await (supabase as any)
        .from(TABLE).update({ is_active }).eq("id", id).select("branch_id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row: any) => qc.invalidateQueries({ queryKey: ["ig-campaigns", row.branch_id] }),
  });
}

export function useDeleteIgCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, branch_id }: { id: string; branch_id: string }) => {
      const { error } = await (supabase as any).from(TABLE).delete().eq("id", id);
      if (error) throw error;
      return { id, branch_id };
    },
    onSuccess: ({ branch_id }) => qc.invalidateQueries({ queryKey: ["ig-campaigns", branch_id] }),
  });
}

// ──────────────── IG Account / Media picker + Test ────────────────

export interface IgAccountInfo {
  integration_id: string;
  branch_id: string | null;
  ig_account_id: string | null;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  error: string | null;
}

export interface IgMediaItem {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

export interface IgTestMatchResult {
  campaign_id: string;
  name: string;
  would_fire: boolean;
  matched_keyword: string | null;
  skip_reason: string | null;
  reply_mode: string;
  delay_seconds: number;
  preview: string | null;
}

async function invokeMetaAdmin<T = any>(body: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("meta-admin", { body });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function useIgAccounts(branchId: string | null) {
  return useQuery({
    queryKey: ["ig-accounts", branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async () => {
      const d = await invokeMetaAdmin<{ accounts: IgAccountInfo[] }>({
        action: "list_ig_accounts", branch_id: branchId,
      });
      return d.accounts ?? [];
    },
  });
}

export function useIgMedia(integrationId: string | null) {
  return useQuery({
    queryKey: ["ig-media", integrationId],
    enabled: !!integrationId,
    staleTime: 60_000,
    queryFn: async () => {
      const d = await invokeMetaAdmin<{ media: IgMediaItem[] }>({
        action: "list_ig_media", integration_id: integrationId, limit: 36,
      });
      return d.media ?? [];
    },
  });
}

export function useTestIgCommentMatch() {
  return useMutation({
    mutationFn: async (input: { branch_id: string; text: string; ig_media_id?: string | null; ig_account_id?: string | null }) => {
      const d = await invokeMetaAdmin<{ results: IgTestMatchResult[] }>({
        action: "test_ig_comment_match", ...input,
      });
      return d.results ?? [];
    },
  });
}

// ──────────────── Retry failed run + 14d trend ────────────────

export function useRetryIgRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; campaign_id: string }) => {
      const { error } = await (supabase as any).rpc("retry_ig_comment_run", { p_id: id });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["ig-runs", vars.campaign_id] }),
  });
}

export interface IgTrendPoint { day: string; sent: number; failed: number; matched: number }

export function useIgRunsTrend(branchId: string | null, days = 14) {
  return useQuery({
    queryKey: ["ig-runs-trend", branchId, days],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async (): Promise<IgTrendPoint[]> => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data, error } = await (supabase as any)
        .from(RUNS)
        .select("created_at,status,action,comment_id")
        .eq("branch_id", branchId!)
        .eq("action", "send_dm")
        .gte("created_at", since);
      if (error) throw error;
      const map = new Map<string, IgTrendPoint & { _seen: Set<string> }>();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
        map.set(d, { day: d, sent: 0, failed: 0, matched: 0, _seen: new Set() });
      }
      for (const r of data ?? []) {
        const d = String(r.created_at).slice(0, 10);
        const slot = map.get(d); if (!slot) continue;
        // Count distinct comment_ids as "matched" (excludes retries + dupes)
        if (r.comment_id && !slot._seen.has(r.comment_id)) {
          slot._seen.add(r.comment_id);
          slot.matched += 1;
        }
        if (r.status === "sent") slot.sent += 1;
        if (r.status === "failed") slot.failed += 1;
      }
      return Array.from(map.values()).map(({ _seen, ...rest }) => rest);
    },
  });
}

// ──────────────── Human-review approval queue ────────────────

export function useIgPendingApprovals(branchId: string | null, campaignId?: string | null) {
  return useQuery({
    queryKey: ["ig-approvals", branchId, campaignId ?? "all"],
    enabled: !!branchId,
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = (supabase as any)
        .from(RUNS)
        .select("*, ig_comment_campaigns!inner(id,name,ig_media_permalink)")
        .eq("branch_id", branchId!)
        .eq("status", "awaiting_review")
        .order("created_at", { ascending: false })
        .limit(200);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<IgCommentRun & {
        ig_comment_campaigns?: { id: string; name: string; ig_media_permalink: string | null } | null;
      }>;
    },
  });
}

export function useIgApprovalsCount(branchId: string | null) {
  return useQuery({
    queryKey: ["ig-approvals-count", branchId],
    enabled: !!branchId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from(RUNS)
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branchId!)
        .eq("status", "awaiting_review");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useReviewIgRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      decision: "approved" | "rejected";
      edited_body?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await (supabase as any).rpc("review_ig_run", {
        p_run_id: input.id,
        p_decision: input.decision,
        p_edited_body: input.edited_body ?? null,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      return data as IgCommentRun;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ig-approvals"] });
      qc.invalidateQueries({ queryKey: ["ig-approvals-count"] });
      qc.invalidateQueries({ queryKey: ["ig-runs"] });
    },
  });
}
