// v1.0.0 — Reads the published visual workflow (agent_flows) and turns it into
// a small set of runtime overrides. Anything missing, invalid or unreachable
// falls back to the code's existing behaviour — the flow can never break the
// assistant, only narrow or widen what it is already allowed to do.

export interface FlowRuntime {
  source: 'flow' | 'default';
  /** Channels the flow listens on. Empty set = no restriction. */
  channels: Set<string>;
  /** Safety checks the flow keeps enabled. */
  checks: Set<string>;
  /** Audiences the flow routes: member | lead | staff. */
  audiences: Set<string>;
  /** Allowed tool names per audience. Empty = no restriction. */
  toolsFor: (audience: string) => string[];
  /** Minutes the assistant stays quiet after a human takes over. */
  handoffPauseMinutes: number;
}

const DEFAULT_RUNTIME: FlowRuntime = {
  source: 'default',
  channels: new Set(['whatsapp', 'instagram', 'messenger']),
  checks: new Set(['opt_out', 'bot_paused', 'blocked', 'duplicate']),
  audiences: new Set(['member', 'lead', 'staff']),
  toolsFor: () => [],
  handoffPauseMinutes: 30,
};

interface GraphNode { id: string; type: string; data?: Record<string, unknown> }
interface GraphEdge { id: string; source: string; target: string; sourceHandle?: string | null }

export async function loadFlowRuntime(
  supabase: { from: (t: string) => any },
  branchId: string | null,
): Promise<FlowRuntime> {
  try {
    let query = supabase
      .from('agent_flows')
      .select('published_graph, is_active, branch_id')
      .eq('key', 'inbound_assistant')
      .eq('is_active', true);
    query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
    let { data } = await query.maybeSingle();

    // Branch flow missing → fall back to the company-wide flow.
    if (!data && branchId) {
      const { data: global } = await supabase
        .from('agent_flows')
        .select('published_graph, is_active, branch_id')
        .eq('key', 'inbound_assistant')
        .eq('is_active', true)
        .is('branch_id', null)
        .maybeSingle();
      data = global;
    }

    const graph = data?.published_graph as { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    if (!graph?.nodes?.length) return DEFAULT_RUNTIME;

    const nodes = graph.nodes;
    const edges = graph.edges ?? [];

    // A flow without a start or without a send step is not trustworthy.
    const trigger = nodes.find((n) => n.type === 'trigger');
    if (!trigger || !nodes.some((n) => n.type === 'send')) return DEFAULT_RUNTIME;

    const channels = new Set<string>(((trigger.data?.channels as string[]) ?? []).filter(Boolean));
    const safety = nodes.find((n) => n.type === 'safety');
    const checks = new Set<string>(((safety?.data?.checks as string[]) ?? [...DEFAULT_RUNTIME.checks]).filter(Boolean));

    const identify = nodes.find((n) => n.type === 'identify');
    const audiences = new Set<string>(
      ((identify?.data?.audiences as string[]) ?? [...DEFAULT_RUNTIME.audiences]).filter(Boolean),
    );

    // Tools reachable from each agent node, keyed by the agent's audience.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, string[]>();
    edges.forEach((e) => outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]));

    const toolMap = new Map<string, string[]>();
    for (const agent of nodes.filter((n) => n.type === 'agent')) {
      const role = (agent.data?.agentRole as string) ?? '';
      if (!role) continue;
      const tools: string[] = [];
      for (const targetId of outgoing.get(agent.id) ?? []) {
        const target = byId.get(targetId);
        if (target?.type === 'tool') tools.push(...(((target.data?.tools as string[]) ?? []).filter(Boolean)));
      }
      toolMap.set(role, tools);
    }

    const handoff = nodes.find((n) => n.type === 'handoff');
    const pause = Number(handoff?.data?.pauseMinutes ?? 30);

    return {
      source: 'flow',
      channels: channels.size ? channels : DEFAULT_RUNTIME.channels,
      checks,
      audiences: audiences.size ? audiences : DEFAULT_RUNTIME.audiences,
      toolsFor: (audience: string) => toolMap.get(audience) ?? [],
      handoffPauseMinutes: Number.isFinite(pause) && pause > 0 ? pause : 30,
    };
  } catch (e) {
    console.error('[agent-flow] falling back to default behaviour:', (e as Error).message);
    return DEFAULT_RUNTIME;
  }
}

export function defaultFlowRuntime(): FlowRuntime {
  return DEFAULT_RUNTIME;
}
