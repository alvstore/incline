// Editable assistant workflow — shared types, default graph and validation.
// The graph stored in `agent_flows.graph` uses exactly this shape, and the
// edge-function interpreter reads the same contract.

export type FlowNodeKind =
  | 'trigger'
  | 'safety'
  | 'identify'
  | 'agent'
  | 'tool'
  | 'condition'
  | 'handoff'
  | 'send'
  | 'end';

export interface FlowNodeData {
  label: string;
  note?: string;
  /** trigger */
  channels?: string[];
  /** safety */
  checks?: string[];
  /** identify */
  audiences?: string[];
  /** agent */
  persona?: string;
  agentRole?: 'lead' | 'member' | 'staff';
  /** tool */
  tools?: string[];
  /** condition */
  field?: string;
  operator?: 'is' | 'is_not' | 'contains' | 'greater_than' | 'less_than';
  value?: string;
  /** handoff */
  pauseMinutes?: number;
  notifyRoles?: string[];
  /** send */
  channel?: 'whatsapp' | 'sms' | 'email' | 'in_app' | 'auto';
  templateKey?: string;
  [key: string]: unknown;
}

export interface FlowNode {
  id: string;
  type: FlowNodeKind;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const NODE_CATALOG: {
  kind: FlowNodeKind;
  label: string;
  blurb: string;
  tone: string;
}[] = [
  { kind: 'trigger', label: 'Message arrives', blurb: 'Where the conversation starts', tone: 'indigo' },
  { kind: 'safety', label: 'Safety gate', blurb: 'Opt-outs, paused chats, blocked numbers', tone: 'slate' },
  { kind: 'identify', label: 'Who is this?', blurb: 'Member, enquiry or team member', tone: 'sky' },
  { kind: 'agent', label: 'Assistant', blurb: 'The AI that writes the reply', tone: 'violet' },
  { kind: 'tool', label: 'Look up information', blurb: 'What the assistant may check', tone: 'cyan' },
  { kind: 'condition', label: 'Decision', blurb: 'Send down one path or another', tone: 'amber' },
  { kind: 'handoff', label: 'Hand to a person', blurb: 'Pause the assistant, alert the team', tone: 'orange' },
  { kind: 'send', label: 'Send reply', blurb: 'Deliver the message', tone: 'emerald' },
  { kind: 'end', label: 'Finish', blurb: 'Nothing more happens', tone: 'emerald' },
];

export const TONE_STYLES: Record<string, { card: string; chip: string }> = {
  indigo: { card: 'border-indigo-200 bg-indigo-50/80', chip: 'bg-indigo-100 text-indigo-700' },
  slate: { card: 'border-slate-200 bg-white', chip: 'bg-slate-100 text-slate-600' },
  sky: { card: 'border-sky-200 bg-sky-50/80', chip: 'bg-sky-100 text-sky-700' },
  violet: { card: 'border-violet-200 bg-violet-50/80', chip: 'bg-violet-100 text-violet-700' },
  cyan: { card: 'border-cyan-200 bg-cyan-50/80', chip: 'bg-cyan-100 text-cyan-700' },
  amber: { card: 'border-amber-200 bg-amber-50/80', chip: 'bg-amber-100 text-amber-700' },
  orange: { card: 'border-orange-200 bg-orange-50/80', chip: 'bg-orange-100 text-orange-700' },
  emerald: { card: 'border-emerald-200 bg-emerald-50/80', chip: 'bg-emerald-100 text-emerald-700' },
};

export function toneForKind(kind: FlowNodeKind): string {
  return NODE_CATALOG.find((n) => n.kind === kind)?.tone ?? 'slate';
}

export const AUDIENCES = ['member', 'lead', 'staff'] as const;

/** The default graph mirrors exactly what the assistant does today. */
export function defaultFlowGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 40, y: 200 },
        data: {
          label: 'Message arrives',
          channels: ['whatsapp', 'instagram', 'messenger'],
          note: 'WhatsApp, Instagram or Messenger delivers the message.',
        },
      },
      {
        id: 'safety',
        type: 'safety',
        position: { x: 320, y: 200 },
        data: {
          label: 'Safety gate',
          checks: ['opt_out', 'bot_paused', 'blocked', 'duplicate'],
          note: 'Stops if the person opted out, the chat is paused or the message repeats.',
        },
      },
      {
        id: 'identify',
        type: 'identify',
        position: { x: 600, y: 200 },
        data: {
          label: 'Who is this?',
          audiences: ['member', 'lead', 'staff'],
          note: 'Matches the number against members, team members and enquiries.',
        },
      },
      {
        id: 'agent-lead',
        type: 'agent',
        position: { x: 900, y: 20 },
        data: { label: 'Enquiry assistant', agentRole: 'lead', persona: 'Ananya', note: 'Sales conversation only — never quotes prices.' },
      },
      {
        id: 'agent-member',
        type: 'agent',
        position: { x: 900, y: 200 },
        data: { label: 'Member assistant', agentRole: 'member', persona: 'Ananya', note: 'Helps with bookings, dues, plans and visits.' },
      },
      {
        id: 'agent-staff',
        type: 'agent',
        position: { x: 900, y: 380 },
        data: { label: 'Team assistant', agentRole: 'staff', persona: 'Ananya', note: 'Answers with live figures, limited by the person\u2019s role.' },
      },
      {
        id: 'tools-member',
        type: 'tool',
        position: { x: 1200, y: 200 },
        data: { label: 'Member look-ups', tools: [], note: 'Membership, bookings, dues and visit history.' },
      },
      {
        id: 'tools-staff',
        type: 'tool',
        position: { x: 1200, y: 380 },
        data: { label: 'Team look-ups', tools: [], note: 'Live figures, limited by role.' },
      },
      {
        id: 'handoff',
        type: 'handoff',
        position: { x: 1200, y: 20 },
        data: { label: 'Hand to a person', pauseMinutes: 30, notifyRoles: ['manager'], note: 'Used when someone asks for a human.' },
      },
      {
        id: 'send',
        type: 'send',
        position: { x: 1500, y: 200 },
        data: { label: 'Send reply', channel: 'auto', note: 'Replies on the same channel the message came in on.' },
      },
      { id: 'end', type: 'end', position: { x: 1760, y: 200 }, data: { label: 'Finish' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'safety' },
      { id: 'e2', source: 'safety', target: 'identify', label: 'allowed' },
      { id: 'e3', source: 'identify', target: 'agent-lead', sourceHandle: 'lead', label: 'enquiry' },
      { id: 'e4', source: 'identify', target: 'agent-member', sourceHandle: 'member', label: 'member' },
      { id: 'e5', source: 'identify', target: 'agent-staff', sourceHandle: 'staff', label: 'team' },
      { id: 'e6', source: 'agent-member', target: 'tools-member' },
      { id: 'e7', source: 'agent-staff', target: 'tools-staff' },
      { id: 'e8', source: 'agent-lead', target: 'send' },
      { id: 'e9', source: 'tools-member', target: 'send' },
      { id: 'e10', source: 'tools-staff', target: 'send' },
      { id: 'e13', source: 'agent-lead', target: 'handoff', label: 'asks for a person' },
      { id: 'e14', source: 'agent-member', target: 'handoff', label: 'asks for a person' },
      { id: 'e11', source: 'handoff', target: 'end' },
      { id: 'e12', source: 'send', target: 'end' },
    ],
  };
}

export interface FlowIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  message: string;
}

export function validateFlow(graph: FlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];

  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) issues.push({ level: 'error', message: 'Add a starting point — a "Message arrives" step.' });
  if (triggers.length > 1) issues.push({ level: 'error', message: 'Only one starting point is allowed.' });

  if (!nodes.some((n) => n.type === 'send')) {
    issues.push({ level: 'error', message: 'The flow never sends a reply. Add a "Send reply" step.' });
  }
  if (!nodes.some((n) => n.type === 'end')) {
    issues.push({ level: 'warning', message: 'Add a "Finish" step so the end of the flow is clear.' });
  }

  const hasIncoming = new Set(edges.map((e) => e.target));
  const hasOutgoing = new Set(edges.map((e) => e.source));

  for (const node of nodes) {
    if (node.type !== 'trigger' && !hasIncoming.has(node.id)) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.data.label}" is not connected to anything before it.` });
    }
    if (node.type !== 'end' && !hasOutgoing.has(node.id)) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.data.label}" has no next step.` });
    }
    if (node.type === 'condition' && (!node.data.field || !node.data.value)) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.data.label}" needs something to check.` });
    }
    if (node.type === 'agent' && !node.data.agentRole) {
      issues.push({ level: 'error', nodeId: node.id, message: `"${node.data.label}" needs to know who it is talking to.` });
    }
  }

  // Reachability from the trigger.
  if (triggers.length === 1) {
    const adj = new Map<string, string[]>();
    edges.forEach((e) => adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]));
    const seen = new Set<string>([triggers[0].id]);
    const stack = [triggers[0].id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    nodes.filter((n) => !seen.has(n.id)).forEach((n) =>
      issues.push({ level: 'warning', nodeId: n.id, message: `"${n.data.label}" can never be reached from the start.` }),
    );
  }

  return issues;
}
