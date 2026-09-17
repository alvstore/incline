// Canvas node renderer for the assistant workflow builder.
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  MessageSquare, ShieldCheck, Users, Brain, Wrench, Split, UserCog, Send, CheckCircle2,
} from 'lucide-react';
import { TONE_STYLES, toneForKind, type FlowNodeData, type FlowNodeKind } from '@/lib/agentFlow/types';

const ICONS: Record<FlowNodeKind, React.ElementType> = {
  trigger: MessageSquare,
  safety: ShieldCheck,
  identify: Users,
  agent: Brain,
  tool: Wrench,
  condition: Split,
  handoff: UserCog,
  send: Send,
  end: CheckCircle2,
};

const KIND_LABEL: Record<FlowNodeKind, string> = {
  trigger: 'Start',
  safety: 'Safety',
  identify: 'Identify',
  agent: 'Assistant',
  tool: 'Look-ups',
  condition: 'Decision',
  handoff: 'Human',
  send: 'Send',
  end: 'Finish',
};

function summarise(kind: FlowNodeKind, data: FlowNodeData): string | undefined {
  switch (kind) {
    case 'trigger':
      return (data.channels ?? []).join(' · ') || undefined;
    case 'safety':
      return `${(data.checks ?? []).length} checks`;
    case 'identify':
      return (data.audiences ?? []).join(' · ') || undefined;
    case 'agent':
      return data.persona ? `${data.persona}` : undefined;
    case 'tool':
      return (data.tools ?? []).length ? `${(data.tools ?? []).length} selected` : 'All allowed';
    case 'condition':
      return data.field ? `${data.field} ${data.operator ?? 'is'} ${data.value ?? ''}`.trim() : 'Not set';
    case 'handoff':
      return `Pause ${data.pauseMinutes ?? 30} min`;
    case 'send':
      return data.channel === 'auto' || !data.channel ? 'Same channel' : String(data.channel);
    default:
      return undefined;
  }
}

const HANDLE_CLASS = '!h-2.5 !w-2.5 !bg-white !border-2 !border-slate-300';

function FlowNodeCardInner({ id, type, data, selected }: NodeProps) {
  const kind = (type ?? 'end') as FlowNodeKind;
  const nodeData = data as FlowNodeData;
  const Icon = ICONS[kind] ?? CheckCircle2;
  const tone = TONE_STYLES[toneForKind(kind)] ?? TONE_STYLES.slate;
  const summary = summarise(kind, nodeData);

  const branches =
    kind === 'identify'
      ? (nodeData.audiences ?? ['member', 'lead', 'staff'])
      : kind === 'condition'
      ? ['yes', 'no']
      : null;

  return (
    <div
      className={`w-[230px] rounded-2xl border px-3.5 py-3 shadow-lg shadow-slate-200/50 transition-all duration-200 ${tone.card} ${
        selected ? 'ring-2 ring-indigo-500 ring-offset-2' : 'hover:shadow-xl hover:shadow-indigo-500/10'
      }`}
    >
      {kind !== 'trigger' && <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />}

      <div className="flex items-start gap-2.5">
        <span className={`rounded-full p-2 ${tone.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{KIND_LABEL[kind]}</p>
          <p className="truncate text-sm font-bold text-slate-900">{nodeData.label}</p>
          {summary && <p className="mt-0.5 truncate text-xs text-slate-500">{summary}</p>}
        </div>
      </div>

      {branches ? (
        <div className="mt-2.5 space-y-1.5 border-t border-slate-200/70 pt-2">
          {branches.map((branch, i) => (
            <div key={branch} className="relative flex items-center justify-end pr-1">
              <span className="text-[11px] font-medium capitalize text-slate-600">{branch}</span>
              <Handle
                id={branch}
                type="source"
                position={Position.Right}
                style={{ top: 'auto', bottom: 'auto', transform: 'none', position: 'absolute', right: -14 }}
                className={HANDLE_CLASS}
                data-index={i}
              />
            </div>
          ))}
        </div>
      ) : (
        kind !== 'end' && <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
      )}
      <span className="sr-only">{id}</span>
    </div>
  );
}

export const FlowNodeCard = memo(FlowNodeCardInner);
