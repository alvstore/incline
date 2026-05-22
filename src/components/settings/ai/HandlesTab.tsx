// SSOT list of AI handles. One HandleCard per ai_purposes row.
// Operational settings (auto-reply, cadence, etc.) live in
// ai_purposes.ops_config and are edited via HandleOpsSettings.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Info } from 'lucide-react';
import { HandleCard, type PurposeRow } from './HandleCard';
import { HandleOpsSettings } from './HandleOpsSettings';

const PURPOSE_LABELS: Record<string, { title: string; desc: string; channel: string }> = {
  whatsapp_reply: {
    title: 'WhatsApp / Meta Replies',
    desc: 'Conversational brain for WhatsApp, Instagram and Messenger inbound messages.',
    channel: 'Inbound conversation',
  },
  lead_nurture: {
    title: 'Lead Nurture Nudges',
    desc: 'Re-engagement messages for cold or partial leads.',
    channel: 'Outbound nudge',
  },
  lead_score: {
    title: 'Lead Scoring',
    desc: '0–100 score plus reasoning and recommended next action.',
    channel: 'Background analyzer',
  },
  campaign_draft: {
    title: 'Campaign Drafter',
    desc: 'Marketing copy for WhatsApp, SMS and Email campaigns.',
    channel: 'Composer assistant',
  },
  template_generate: {
    title: 'Template Generator',
    desc: 'WhatsApp Cloud API templates ready for Meta approval.',
    channel: 'Composer assistant',
  },
  dashboard_insight: {
    title: 'Dashboard Insights',
    desc: 'Business-analyst style summaries of KPIs and trends.',
    channel: 'In-app insight',
  },
  fitness_plan: {
    title: 'Fitness Plan Generator',
    desc: 'Personalised workout and nutrition plans for members.',
    channel: 'Member tooling',
  },
  review_reply: {
    title: 'Google Review Replies',
    desc: 'Classifies reviews and drafts on-brand public replies.',
    channel: 'Outbound reply',
  },
  automation_rule: {
    title: 'Automation Rules',
    desc: 'AI tone for birthday wishes and rule-driven outbound sends.',
    channel: 'Outbound automation',
  },
};

const PRIORITY = [
  'whatsapp_reply',
  'lead_nurture',
  'lead_score',
  'review_reply',
  'campaign_draft',
  'template_generate',
  'fitness_plan',
  'dashboard_insight',
  'automation_rule',
];

const PURPOSES_WITH_OPS = new Set(['whatsapp_reply', 'lead_nurture']);

export function HandlesTab({ onJumpToKnowledge }: { onJumpToKnowledge?: () => void }) {
  const [openHandle, setOpenHandle] = useState<string | null>('whatsapp_reply');

  const { data: purposes = [], isLoading } = useQuery({
    queryKey: ['ai_purposes', 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_purposes')
        .select('*')
        .is('branch_id', null)
        .order('purpose');
      if (error) throw error;
      return (data as PurposeRow[]) ?? [];
    },
  });

  const ordered = useMemo(
    () =>
      [...purposes].sort(
        (a, b) =>
          (PRIORITY.indexOf(a.purpose) === -1 ? 999 : PRIORITY.indexOf(a.purpose)) -
          (PRIORITY.indexOf(b.purpose) === -1 ? 999 : PRIORITY.indexOf(b.purpose)),
      ),
    [purposes],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50/60 border border-indigo-100">
        <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-600">
          One card per AI handle, one editor inside. Edit <b>persona, model and operational
          settings</b> here. Shared facts, offers and rules live in the <b>Knowledge</b> tab and
          apply to every handle.
        </p>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Loading handles…</div>}

      <div className="space-y-3">
        {ordered.map((row) => (
          <HandleCard
            key={row.id}
            row={row}
            meta={PURPOSE_LABELS[row.purpose] ?? { title: row.purpose, desc: '', channel: '' }}
            open={openHandle === row.purpose}
            onOpenChange={(o) => setOpenHandle(o ? row.purpose : null)}
            onJumpToKnowledge={onJumpToKnowledge}
            opsSlot={
              PURPOSES_WITH_OPS.has(row.purpose) ? (
                <HandleOpsSettings
                  purposeId={row.id}
                  purpose={row.purpose}
                  opsConfig={(row as any).ops_config ?? {}}
                />
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
}
