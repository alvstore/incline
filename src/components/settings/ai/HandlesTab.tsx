// SSOT for AI handles. One expandable card per ai_purposes row.
// Each card shows: persona/tone · knowledge in use · operational settings · model/sandbox.
// Replaces the standalone Purposes / Auto-Reply / Lead Capture / Lead Nurture tabs.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Zap,
  Pencil,
  FlaskConical,
  MessageSquare,
  Clock,
  Workflow,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { KnowledgeForHandle } from './KnowledgeForHandle';
import { WhatsAppAISettings } from '@/components/settings/WhatsAppAISettings';
import { LeadNurtureSettings } from '@/components/settings/LeadNurtureSettings';
import { AIFlowBuilderSettings } from '@/components/settings/AIFlowBuilderSettings';
import { AIPurposesTab } from '@/components/settings/AIPurposesTab';

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

const OPS_PANELS: Record<string, { icon: typeof MessageSquare; label: string; render: () => JSX.Element }> = {
  whatsapp_reply: {
    icon: MessageSquare,
    label: 'Auto-reply & delay',
    render: () => <WhatsAppAISettings />,
  },
  lead_nurture: {
    icon: Clock,
    label: 'Cadence & retries',
    render: () => <LeadNurtureSettings />,
  },
};

const LEAD_CAPTURE_PANEL = {
  icon: Workflow,
  label: 'Lead capture flow',
  render: () => <AIFlowBuilderSettings />,
};

interface PurposeRow {
  id: string;
  branch_id: string | null;
  purpose: string;
  enabled: boolean;
  provider_id: string | null;
  model: string | null;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  updated_at: string;
}

export function HandlesTab({ onJumpToKnowledge }: { onJumpToKnowledge?: () => void }) {
  const [openHandle, setOpenHandle] = useState<string | null>('whatsapp_reply');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

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

  const handleTest = async (purpose: string) => {
    setTesting(purpose);
    try {
      const { data, error } = await supabase.functions.invoke('ai-test-purpose', { body: { purpose } });
      if (error) throw error;
      if (data?.success) {
        const label = `${data.provider} · ${data.model} · ${data.latency_ms}ms`;
        if (data.fallback_used) {
          toast.warning(`${label} (fallback to Lovable)`, {
            description: 'Primary provider failed — check Plumbing → Call Logs.',
          });
        } else {
          toast.success(label, { description: data.sample?.slice(0, 120) || undefined });
        }
      } else {
        toast.error(data?.error || 'Test failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Test failed');
    } finally {
      setTesting(null);
    }
  };

  // Ordered: customer-facing first, then admin tooling.
  const ordered = useMemo(() => {
    const priority = [
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
    return [...purposes].sort(
      (a, b) => (priority.indexOf(a.purpose) + 100) - (priority.indexOf(b.purpose) + 100),
    );
  }, [purposes]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-indigo-50/60 border border-indigo-100">
        <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-600">
          One card per AI handle. Edit the <b>persona/tone</b> here; facts, offers and rules live in the{' '}
          <b>Knowledge</b> tab and are shared across handles. Operational settings (auto-reply, cadence,
          capture flow) sit inside the handle that owns them.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-slate-500"
        >
          {showAdvanced ? 'Hide' : 'Show'} model & sampling editors
        </Button>
      </div>

      {showAdvanced && (
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Advanced — per-purpose persona, provider and sampling
          </div>
          <AIPurposesTab />
        </Card>
      )}

      {isLoading && <div className="text-sm text-slate-500">Loading handles…</div>}

      <div className="space-y-3">
        {ordered.map((p) => {
          const meta = PURPOSE_LABELS[p.purpose] ?? { title: p.purpose, desc: '', channel: '' };
          const ops = OPS_PANELS[p.purpose];
          const isOpen = openHandle === p.purpose;
          return (
            <Collapsible
              key={p.id}
              open={isOpen}
              onOpenChange={(o) => setOpenHandle(o ? p.purpose : null)}
              asChild
            >
              <Card
                className={`rounded-2xl shadow-lg shadow-slate-200/50 transition-all ${
                  isOpen ? 'ring-1 ring-indigo-200' : 'hover:shadow-xl hover:shadow-indigo-500/10'
                }`}
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-left p-4 sm:p-5 flex items-start gap-3 sm:gap-4"
                  >
                    <div
                      className={`shrink-0 p-2.5 rounded-xl ${
                        p.enabled
                          ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/20'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Bot className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{meta.title}</h3>
                        {p.enabled ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            Live
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                            Disabled
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {meta.channel}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono gap-1">
                          <Zap className="h-3 w-3 text-violet-600" />
                          {p.model || 'provider default'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{meta.desc}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-1 shrink-0 text-slate-400">
                      {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-4 sm:px-5 pb-5 space-y-5 border-t pt-5">
                    {/* Persona stub preview */}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                        Persona & tone
                      </div>
                      <p className="text-xs text-slate-600 font-mono bg-slate-50 p-3 rounded-lg leading-relaxed">
                        {p.system_prompt?.slice(0, 400) || '(no persona set)'}
                        {p.system_prompt && p.system_prompt.length > 400 && '…'}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {p.system_prompt?.length || 0} chars. Edit in <b>Advanced</b> above.
                      </p>
                    </div>

                    {/* Knowledge in use */}
                    <KnowledgeForHandle purpose={p.purpose} onOpenKnowledge={onJumpToKnowledge} />

                    {/* Operational panel — only purposes that have one */}
                    {ops && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                          <ops.icon className="h-3.5 w-3.5 text-indigo-600" />
                          {ops.label}
                        </div>
                        {ops.render()}
                      </div>
                    )}

                    {/* Lead capture flow attached to whatsapp_reply handle */}
                    {p.purpose === 'whatsapp_reply' && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                          <LEAD_CAPTURE_PANEL.icon className="h-3.5 w-3.5 text-indigo-600" />
                          {LEAD_CAPTURE_PANEL.label}
                        </div>
                        {LEAD_CAPTURE_PANEL.render()}
                      </div>
                    )}

                    {/* Footer actions */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowAdvanced(true)}
                        className="gap-1.5"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit persona / model
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleTest(p.purpose)}
                        disabled={testing === p.purpose}
                        className="gap-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                      >
                        {testing === p.purpose ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FlaskConical className="h-3.5 w-3.5" />
                        )}
                        Test handle
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
