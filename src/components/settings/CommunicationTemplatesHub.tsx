import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, Mail, Phone, Sparkles, Workflow, PhoneForwarded, FileText, Wand2 } from 'lucide-react';
import { TemplateManager } from './TemplateManager';
import { WhatsAppAutomations } from './WhatsAppAutomations';
import { TemplateCoverageMatrix } from './TemplateCoverageMatrix';

// AI Agent settings live in their own settings entry; not duplicated here.
import { WhatsAppRoutingSettings } from './WhatsAppRoutingSettings';
import { AIGenerateTemplatesDrawer } from './AIGenerateTemplatesDrawer';

type Channel = 'whatsapp' | 'sms' | 'email';
type SectionId = 'templates' | 'coverage' | 'automations' | 'routing';

interface TemplatePrefill {
  name: string;
  trigger: string;
  content: string;
  type?: Channel;
  eventName?: string;
}

const EVENT_PREFILLS: Record<string, TemplatePrefill> = {
  member_created: { name: 'Welcome New Member', trigger: 'welcome', content: 'Hi {{member_name}}, welcome to {{branch_name}}! Your member code is {{member_code}}.' },
  payment_received: { name: 'Payment Received', trigger: 'payment_received', content: "Hi {{member_name}}, we've received your payment of ₹{{amount}} for invoice {{invoice_number}}. Thank you!" },
  membership_expiring_7d: { name: 'Membership Expiring in 7 Days', trigger: 'expiry_reminder', content: 'Hi {{member_name}}, your {{plan_name}} ends on {{end_date}}. Renew today.' },
  birthday: { name: 'Birthday Wish', trigger: 'birthday', content: 'Happy birthday, {{member_name}}! Wishing you a strong year from {{branch_name}}.' },
};

const CHANNELS: { value: Channel; label: string; icon: any; blurb: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, blurb: 'CRM templates, Meta approvals, event mapping and automations.' },
  { value: 'sms', label: 'SMS', icon: Phone, blurb: 'Transactional and promotional SMS with DLT-friendly limits.' },
  { value: 'email', label: 'Email', icon: Mail, blurb: 'Subject, HTML body, attachments and AI-assisted drafting.' },
];

const SECTIONS: Record<Channel, { id: SectionId; label: string; icon: any; hint: string }[]> = {
  whatsapp: [
    { id: 'templates', label: 'Templates', icon: FileText, hint: 'Author and edit' },
    { id: 'coverage', label: 'Coverage & AI', icon: Wand2, hint: 'Event gaps' },
    { id: 'automations', label: 'Automations', icon: Workflow, hint: 'Triggers' },
    { id: 'routing', label: 'Number routing', icon: PhoneForwarded, hint: 'Staff numbers' },
  ],
  sms: [
    { id: 'templates', label: 'Templates', icon: FileText, hint: 'Author and edit' },
    { id: 'coverage', label: 'Coverage & AI', icon: Wand2, hint: 'Event gaps' },
  ],
  email: [
    { id: 'templates', label: 'Templates', icon: FileText, hint: 'Author and edit' },
    { id: 'coverage', label: 'Coverage & AI', icon: Wand2, hint: 'Event gaps' },
  ],
};

interface HealthCounts {
  total: number;
  active: number;
  approved: number;
  pending: number;
  rejected: number;
  draft: number;
}

function HealthStrip({ channel }: { channel: Channel }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['template-health-strip'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_template_with_meta_status' as any)
        .select('type, is_active, approval_status');
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 30_000,
  });

  const counts = useMemo<HealthCounts>(() => {
    const rows = (data || []).filter((r: any) => r.type === channel);
    return {
      total: rows.length,
      active: rows.filter((r: any) => r.is_active).length,
      approved: rows.filter((r: any) => r.approval_status === 'approved').length,
      pending: rows.filter((r: any) => r.approval_status === 'pending').length,
      rejected: rows.filter((r: any) => r.approval_status === 'rejected').length,
      draft: rows.filter((r: any) => !r.approval_status || r.approval_status === 'draft').length,
    };
  }, [data, channel]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
      </div>
    );
  }
  if (isError) {
    return <p className="text-xs text-destructive">Couldn't load template health right now.</p>;
  }

  const tiles = channel === 'whatsapp'
    ? [
        { label: 'Total', value: counts.total, cls: 'text-foreground' },
        { label: 'Approved', value: counts.approved, cls: 'text-success' },
        { label: 'Pending', value: counts.pending, cls: 'text-warning' },
        { label: 'Rejected / draft', value: counts.rejected + counts.draft, cls: 'text-destructive' },
      ]
    : [
        { label: 'Total', value: counts.total, cls: 'text-foreground' },
        { label: 'Active', value: counts.active, cls: 'text-success' },
        { label: 'Inactive', value: counts.total - counts.active, cls: 'text-muted-foreground' },
      ];

  return (
    <div className={`grid gap-3 grid-cols-2 ${tiles.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl bg-white border border-slate-100 shadow-xl shadow-slate-200/30 px-5 py-4 transition-all hover:shadow-2xl hover:shadow-slate-200/50">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] mb-1">{t.label}</p>
          <p className={`text-2xl font-black ${t.cls}`}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

export function CommunicationTemplatesHub() {
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [section, setSection] = useState<SectionId>('templates');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiChannel, setAiChannel] = useState<Channel | undefined>(undefined);
  const [prefill, setPrefill] = useState<TemplatePrefill | null>(null);

  const openAi = (c?: Channel) => { setAiChannel(c); setAiOpen(true); };

  const handleMap = (eventName: string) => {
    const p = EVENT_PREFILLS[eventName] || {
      name: eventName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      trigger: 'custom',
      content: '',
      type: 'whatsapp' as Channel,
    };
    setPrefill({ ...p, type: 'whatsapp', eventName });
    setChannel('whatsapp');
    setSection('templates');
  };

  const sections = SECTIONS[channel];
  const activeChannel = CHANNELS.find((c) => c.value === channel)!;

  const switchChannel = (c: Channel) => {
    setChannel(c);
    setSection('templates');
  };

  return (
    <>
      <div className="space-y-5">
        {/* Header: channel switch + primary action */}
        <div className="rounded-2xl bg-white border border-slate-100 shadow-xl shadow-slate-200/40 p-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-1 bg-slate-100/80 rounded-2xl p-1 w-fit border border-slate-200/60">
            {CHANNELS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => switchChannel(value)}
                aria-pressed={channel === value}
                className={`cursor-pointer inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  channel === value
                    ? 'bg-white text-indigo-700 shadow-lg shadow-indigo-100 border border-slate-100'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <Icon className={`h-4.5 w-4.5 ${channel === value ? 'text-indigo-600' : 'text-slate-400'}`} /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <p className="hidden xl:block text-xs font-medium text-slate-500 max-w-[320px] leading-relaxed">
              {activeChannel.blurb}
            </p>
            <Button onClick={() => openAi(channel)} className="gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 text-white font-semibold h-11 px-6 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <Sparkles className="h-4.5 w-4.5" /> AI Generator Studio
            </Button>
          </div>
        </div>

        <HealthStrip channel={channel} />

        {/* Workbench: left rail + content */}
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Template sections" className="lg:sticky lg:top-4 h-fit">
            <ul className="flex lg:flex-col gap-1 overflow-x-auto">
              {sections.map(({ id, label, icon: Icon, hint }) => (
                <li key={id} className="shrink-0 lg:w-full">
                  <button
                    type="button"
                    onClick={() => setSection(id)}
                    aria-current={section === id ? 'page' : undefined}
                    className={`cursor-pointer w-full text-left rounded-xl px-4 py-3 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-1 group ${
                      section === id
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-[1.02]'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-3 text-sm font-semibold tracking-tight">
                      <Icon className={`h-4.5 w-4.5 ${section === id ? 'text-white' : 'text-slate-400 group-hover:text-indigo-500'}`} /> 
                      {label}
                    </span>
                    <span className={`hidden lg:block text-[11px] mt-1 pl-7.5 leading-tight ${section === id ? 'text-indigo-100/90' : 'text-slate-400'}`}>
                      {hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            {section === 'templates' && (
              <Card className="rounded-2xl shadow-lg shadow-primary/5 border-0">
                <CardContent className="pt-6">
                  <TemplateManager
                    key={channel}
                    filterType={channel}
                    hideHeader
                    prefill={channel === 'whatsapp' ? (prefill ?? undefined) : undefined}
                    onPrefillConsumed={() => setPrefill(null)}
                  />
                </CardContent>
              </Card>
            )}

            {section === 'coverage' && <TemplateCoverageMatrix channel={channel} />}

            {section === 'automations' && (
              <Card className="rounded-2xl shadow-lg shadow-primary/5 border-0">
                <CardContent className="pt-6"><WhatsAppAutomations /></CardContent>
              </Card>
            )}

            {section === 'routing' && (
              <Card className="rounded-2xl shadow-lg shadow-primary/5 border-0">
                <CardContent className="pt-6"><WhatsAppRoutingSettings /></CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <AIGenerateTemplatesDrawer open={aiOpen} onOpenChange={setAiOpen} channel={aiChannel} />
    </>
  );
}
