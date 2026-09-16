// Visual Flow — a live, readable map of how an inbound message travels through
// the two-agent router (lead vs member), which tools each side may use, and
// where a human takes over. Reads real config from ai_purposes so the diagram
// always reflects what the system will actually do.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MessageSquare, Instagram, Facebook, PhoneCall, ShieldCheck, Split,
  UserPlus, IdCard, Brain, Wrench, UserCog, CheckCircle2, Ban, ArrowDown,
  Sparkles, Users,
} from 'lucide-react';

type Journey = 'lead' | 'member' | 'internal' | 'voice';

const JOURNEYS: { id: Journey; label: string; icon: React.ElementType; blurb: string }[] = [
  { id: 'lead', label: 'New enquiry', icon: UserPlus, blurb: 'Someone who is not a member yet' },
  { id: 'member', label: 'Member', icon: IdCard, blurb: 'A recognised member asking for help' },
  { id: 'internal', label: 'Team member', icon: Users, blurb: 'A trainer or employee messaging in' },
  { id: 'voice', label: 'Voice call', icon: PhoneCall, blurb: 'Outbound renewal / retention call' },
];

type NodeTone = 'entry' | 'check' | 'agent' | 'tool' | 'human' | 'end' | 'stop';

const TONES: Record<NodeTone, { ring: string; chip: string }> = {
  entry: { ring: 'border-indigo-200 bg-indigo-50/70', chip: 'bg-indigo-100 text-indigo-700' },
  check: { ring: 'border-slate-200 bg-white', chip: 'bg-slate-100 text-slate-600' },
  agent: { ring: 'border-violet-200 bg-violet-50/70', chip: 'bg-violet-100 text-violet-700' },
  tool: { ring: 'border-sky-200 bg-sky-50/70', chip: 'bg-sky-100 text-sky-700' },
  human: { ring: 'border-amber-200 bg-amber-50/70', chip: 'bg-amber-100 text-amber-700' },
  end: { ring: 'border-emerald-200 bg-emerald-50/70', chip: 'bg-emerald-100 text-emerald-700' },
  stop: { ring: 'border-red-200 bg-red-50/70', chip: 'bg-red-100 text-red-700' },
};

interface FlowNode {
  id: string;
  title: string;
  detail: string;
  tone: NodeTone;
  icon: React.ElementType;
  status?: { label: string; ok: boolean };
  items?: string[];
}

export function AgentFlowCanvas() {
  const [journey, setJourney] = useState<Journey>('lead');

  const { data: purpose, isLoading } = useQuery({
    queryKey: ['ai-flow-purpose', 'whatsapp_reply'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_purposes')
        .select('id, is_active, tools_allowed, ops_config')
        .eq('purpose', 'whatsapp_reply')
        .is('branch_id', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const channels = ((purpose?.ops_config as any)?.channels ?? {}) as Record<string, boolean>;
  const channelOn = (key: string) => channels[key] !== false;
  const toolCount = ((purpose?.tools_allowed as string[] | null) ?? []).length;
  const toolLabel = toolCount === 0 ? 'All tools available' : `${toolCount} tools allowed`;
  const agentLive = purpose?.is_active !== false;

  const nodes: FlowNode[] = useMemo(() => {
    const entry: FlowNode = {
      id: 'entry',
      title: journey === 'voice' ? 'Renewal or retention call starts' : 'Message arrives',
      detail:
        journey === 'voice'
          ? 'Staff press Call now in the Renewal Center, or a retention case escalates.'
          : 'WhatsApp, Instagram or Messenger delivers the message to the assistant.',
      tone: 'entry',
      icon: journey === 'voice' ? PhoneCall : MessageSquare,
      status: { label: agentLive ? 'Assistant is live' : 'Assistant is paused', ok: agentLive },
      items:
        journey === 'voice'
          ? ['Caller ID +91 80653 83003', 'Ananya voice agent']
          : [
              `WhatsApp ${channelOn('whatsapp') ? 'on' : 'off'}`,
              `Instagram ${channelOn('instagram') ? 'on' : 'off'}`,
              `Messenger ${channelOn('messenger') ? 'on' : 'off'}`,
            ],
    };

    const guard: FlowNode = {
      id: 'guard',
      title: 'Safety checks',
      detail: 'Opted-out contacts, paused chats and anything off-topic stop right here.',
      tone: 'check',
      icon: ShieldCheck,
      items: ['Do-not-contact respected', 'Paused chats skipped', 'Off-topic politely redirected'],
    };

    const identity: FlowNode = {
      id: 'identity',
      title: 'Who is this?',
      detail: 'The phone number is matched against members, then trainers and staff, then past enquiries.',
      tone: 'check',
      icon: Split,
      items: ['Member record', 'Team member record', 'Earlier conversations recalled'],
    };

    if (journey === 'lead') {
      return [
        entry,
        guard,
        identity,
        {
          id: 'lead-agent',
          title: 'Sales assistant',
          detail: 'Answers questions about the club and gently collects details, one at a time.',
          tone: 'agent',
          icon: Sparkles,
          items: ['Name', 'Email', 'Fitness goal', 'Plan interest'],
        },
        {
          id: 'lead-guard',
          title: 'No member data, no prices',
          detail: 'This side has no access to accounts, bookings, invoices or payments, and never quotes fees.',
          tone: 'stop',
          icon: Ban,
          status: { label: 'Zero operational tools', ok: true },
        },
        {
          id: 'lead-out',
          title: 'Enquiry saved and a visit offered',
          detail: 'A lead is created with the captured details and the team is alerted to follow up.',
          tone: 'end',
          icon: CheckCircle2,
          items: ['Lead created', 'Club visit offered', 'Staff notified'],
        },
      ];
    }

    if (journey === 'member') {
      return [
        entry,
        guard,
        identity,
        {
          id: 'member-agent',
          title: 'Member concierge',
          detail: 'Recognises the member and answers from their own account — never asks for their name again.',
          tone: 'agent',
          icon: Brain,
          items: ['Membership status', 'Dues and invoices', 'Bookings', 'Plans and sessions'],
        },
        {
          id: 'member-tools',
          title: 'Actions it can take',
          detail: 'Real actions run against the live system, limited to whatever you have switched on.',
          tone: 'tool',
          icon: Wrench,
          status: { label: toolLabel, ok: true },
          items: ['Book or cancel a recovery slot', 'Book a class', 'Share dues and send a payment link', 'Request a freeze or resume'],
        },
        {
          id: 'member-handoff',
          title: 'Hand over to a person',
          detail: 'Complaints, refunds and anything sensitive are passed to the team instead of being answered.',
          tone: 'human',
          icon: UserCog,
          items: ['Chat marked for staff', 'Follow-up task created'],
        },
        {
          id: 'member-out',
          title: 'Confirmed to the member',
          detail: 'The member gets a confirmation and the record is updated in the same moment.',
          tone: 'end',
          icon: CheckCircle2,
        },
      ];
    }

    if (journey === 'internal') {
      return [
        entry,
        guard,
        {
          id: 'internal-match',
          title: 'Recognised as team',
          detail: 'The number matches a trainer or employee, so this is never treated as a sales enquiry.',
          tone: 'check',
          icon: Users,
          items: ['No lead created', 'No sales pitch', 'No follow-up task raised'],
        },
        {
          id: 'internal-out',
          title: 'Routed to the team inbox',
          detail: 'The message lands with the right people instead of being answered by the sales assistant.',
          tone: 'end',
          icon: CheckCircle2,
        },
      ];
    }

    return [
      entry,
      {
        id: 'voice-reason',
        title: 'Why we are calling',
        detail: 'The call opens differently for a renewal than for a member we have not seen in a while.',
        tone: 'check',
        icon: Split,
        items: ['Renewal — plan ending soon', 'Retention — member absent'],
      },
      {
        id: 'voice-agent',
        title: 'Ananya speaks to the member',
        detail: 'Talks through their plan and the club experience, and never quotes prices or discounts.',
        tone: 'agent',
        icon: PhoneCall,
        items: ['Renewal interest', 'Facility experience', 'Callback offer'],
      },
      {
        id: 'voice-outcome',
        title: 'Outcome updates the case',
        detail: 'Callbacks are scheduled automatically and anything needing a person moves to staff follow-up.',
        tone: 'human',
        icon: UserCog,
        items: ['Callback booked', 'Staff follow-up', 'Not interested'],
      },
      {
        id: 'voice-out',
        title: 'Logged on the member',
        detail: 'Recording, summary and next step are saved against the renewal case.',
        tone: 'end',
        icon: CheckCircle2,
      },
    ];
  }, [journey, agentLive, toolLabel, channels]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="rounded-2xl border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/20">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-bold text-white">How the assistant handles a conversation</CardTitle>
          <CardDescription className="text-indigo-100">
            Pick a journey to see exactly what happens, step by step, with your current settings applied.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {JOURNEYS.map((j) => {
              const Icon = j.icon;
              const active = journey === j.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setJourney(j.id)}
                  aria-pressed={active}
                  className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl p-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/70 ${
                    active ? 'bg-white text-slate-900 shadow-lg' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <span className={`rounded-full p-2 ${active ? 'bg-indigo-50 text-indigo-600' : 'bg-white/15 text-white'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{j.label}</span>
                    <span className={`block text-xs ${active ? 'text-slate-500' : 'text-indigo-100'}`}>{j.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-0">
        {nodes.map((node, i) => {
          const Icon = node.icon;
          const tone = TONES[node.tone];
          return (
            <div key={node.id}>
              <Card className={`rounded-2xl border ${tone.ring} shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10`}>
                <CardContent className="flex gap-4 p-4">
                  <div className="flex flex-col items-center">
                    <span className={`rounded-full p-2.5 ${tone.chip}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="mt-2 text-xs font-semibold text-slate-400">{i + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-slate-900">{node.title}</h4>
                      {node.status && (
                        <Badge
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            node.status.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {node.status.label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-600">{node.detail}</p>
                    {node.items?.length ? (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {node.items.map((item) => (
                          <span key={item} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
              {i < nodes.length - 1 && (
                <div className="flex justify-center py-1.5" aria-hidden="true">
                  <ArrowDown className="h-4 w-4 text-slate-300" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl bg-white shadow-lg shadow-slate-200/50">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Legend</span>
          {[
            ['Entry point', TONES.entry.chip],
            ['Check', TONES.check.chip],
            ['Assistant', TONES.agent.chip],
            ['Real action', TONES.tool.chip],
            ['Person takes over', TONES.human.chip],
            ['Blocked', TONES.stop.chip],
            ['Finished', TONES.end.chip],
          ].map(([label, chip]) => (
            <span key={label} className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${chip}`} />
              {label}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
