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
