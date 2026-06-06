// SSOT for AI purposes (handles). Live source = `ai_purposes` table.
// Fallback metadata supplies friendly title + channel grouping when a new
// purpose is added via migration before this file gets corresponding labels.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ChannelGroup =
  | 'Wildcard'
  | 'Inbound'
  | 'Outbound'
  | 'Composer'
  | 'Background'
  | 'Member tooling'
  | 'Other';

export interface PurposeMeta {
  key: string;
  title: string;
  description: string;
  channelGroup: ChannelGroup;
  enabled: boolean;
  isWildcard: boolean;
}

const FALLBACK: Record<
  string,
  Omit<PurposeMeta, 'key' | 'enabled' | 'isWildcard'>
> = {
  all: {
    title: 'All handles (wildcard)',
    description: 'Share this entry with every AI handle.',
    channelGroup: 'Wildcard',
  },
  whatsapp_reply: {
    title: 'WhatsApp / Meta Replies',
    description: 'Conversational brain for WhatsApp, Instagram, Messenger.',
    channelGroup: 'Inbound',
  },
  lead_nurture: {
    title: 'Lead Nurture Nudges',
    description: 'Re-engagement messages for cold or partial leads.',
    channelGroup: 'Outbound',
  },
  lead_score: {
    title: 'Lead Scoring',
    description: '0–100 score plus reasoning and recommended next action.',
    channelGroup: 'Background',
  },
  review_reply: {
    title: 'Google Review Replies',
    description: 'On-brand public replies to Google reviews.',
    channelGroup: 'Outbound',
  },
  campaign_draft: {
    title: 'Campaign Drafter',
    description: 'WhatsApp / SMS / Email marketing copy.',
    channelGroup: 'Composer',
  },
  template_generate: {
    title: 'Template Generator',
    description: 'WhatsApp Cloud API templates ready for Meta approval.',
    channelGroup: 'Composer',
  },
  fitness_plan: {
    title: 'Fitness Plan Generator',
    description: 'Personalised workout & nutrition plans for members.',
    channelGroup: 'Member tooling',
  },
  dashboard_insight: {
    title: 'Dashboard Insights',
    description: 'Business-analyst style KPI summaries and trends.',
    channelGroup: 'Background',
  },
  automation_rule: {
    title: 'Automation Rules',
    description: 'AI tone for birthday wishes and rule-driven sends.',
    channelGroup: 'Outbound',
  },
};

const GROUP_ORDER: ChannelGroup[] = [
  'Wildcard',
  'Inbound',
  'Outbound',
  'Composer',
  'Background',
  'Member tooling',
  'Other',
];

function metaFor(key: string, enabled: boolean): PurposeMeta {
  const fb = FALLBACK[key];
  return {
    key,
    title: fb?.title ?? key,
    description: fb?.description ?? '',
    channelGroup: fb?.channelGroup ?? 'Other',
    enabled,
    isWildcard: key === 'all',
  };
}

/**
 * Returns the canonical list of AI purposes for pickers.
 * - Live rows from `ai_purposes` (branch_id IS NULL).
 * - Always prepends the synthetic `all` wildcard.
 */
export function useAiPurposes() {
  return useQuery({
    queryKey: ['ai_purposes_registry'],
    staleTime: 60_000,
    queryFn: async (): Promise<PurposeMeta[]> => {
      const { data, error } = await supabase
        .from('ai_purposes')
        .select('purpose, enabled')
        .is('branch_id', null)
        .order('purpose');
      if (error) throw error;

      const live = (data ?? []).map((r: { purpose: string; enabled: boolean }) =>
        metaFor(r.purpose, r.enabled !== false),
      );
      return [metaFor('all', true), ...live];
    },
  });
}

export function groupPurposes(items: PurposeMeta[]) {
  const buckets = new Map<ChannelGroup, PurposeMeta[]>();
  for (const it of items) {
    const arr = buckets.get(it.channelGroup) ?? [];
    arr.push(it);
    buckets.set(it.channelGroup, arr);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    items: buckets.get(g)!,
  }));
}

export function titleFor(key: string, registry: PurposeMeta[] | undefined) {
  return registry?.find((p) => p.key === key)?.title ?? FALLBACK[key]?.title ?? key;
}

export { FALLBACK as PURPOSE_FALLBACK_META };
