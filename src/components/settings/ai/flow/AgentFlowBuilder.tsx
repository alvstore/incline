// Editable visual workflow for the inbound assistant. Drag steps on to the
// canvas, join them up, open a step to change how it behaves, then publish.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useEdgesState, useNodesState, MarkerType,
  type Connection, type Edge, type Node, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Save, Rocket, RotateCcw, History, AlertTriangle, CheckCircle2, Plus, Loader2,
} from 'lucide-react';
import {
  NODE_CATALOG, TONE_STYLES, defaultFlowGraph, toneForKind, validateFlow,
  type FlowGraph, type FlowNode as FlowNodeShape, type FlowNodeData, type FlowNodeKind,
} from '@/lib/agentFlow/types';
import { FlowNodeCard } from './FlowNodeCard';
import { NodeSettingsDrawer } from './NodeSettingsDrawer';

const FLOW_KEY = 'inbound_assistant';
const nodeTypes = Object.fromEntries(NODE_CATALOG.map((n) => [n.kind, FlowNodeCard]));

interface FlowRow {
  id: string;
  branch_id: string | null;
  key: string;
  name: string;
  status: string;
  graph: FlowGraph;
  published_graph: FlowGraph | null;
  published_at: string | null;
  version: number;
  is_active: boolean;
}

function toReactFlow(graph: FlowGraph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: (graph.nodes ?? []).map((n) => ({
      id: n.id, type: n.type, position: n.position, data: { ...n.data },
    })),
    edges: (graph.edges ?? []).map((e) => ({
      id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null,
      label: e.label, animated: true, style: { strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  };
}

function fromReactFlow(nodes: Node[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id, type: (n.type ?? 'end') as FlowNodeKind, position: n.position, data: n.data as FlowNodeData,
    })),
    edges: edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? null, label: typeof e.label === 'string' ? e.label : undefined,
    })),
  };
}

function BuilderInner() {
  const queryClient = useQueryClient();
  const { selectedBranch } = useBranchContext();
  const { roles } = useAuth();
  const canEdit = can.manageSettings(roles ?? []);
  const branchId = selectedBranch === 'all' ? null : selectedBranch;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<FlowNodeShape | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);

  const { data: flow, isLoading, isError } = useQuery({
    queryKey: ['agent-flow', FLOW_KEY, branchId],
    queryFn: async (): Promise<FlowRow | null> => {
      let query = supabase.from('agent_flows').select('*').eq('key', FLOW_KEY);
      query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return (data as unknown as FlowRow) ?? null;
    },
  });

  const { data: versions } = useQuery({
    queryKey: ['agent-flow-versions', flow?.id],
    enabled: !!flow?.id && historyOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_flow_versions')
        .select('id, version, note, created_at, graph')
        .eq('flow_id', flow!.id)
        .order('version', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load the saved graph (or today's behaviour as a starting point).
  useEffect(() => {
    if (isLoading) return;
    const graph = flow?.graph?.nodes?.length ? flow.graph : defaultFlowGraph();
    const { nodes: n, edges: e } = toReactFlow(graph);
    setNodes(n);
    setEdges(e);
    setDirty(false);
  }, [flow?.id, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const graph = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges]);
  const issues = useMemo(() => validateFlow(graph), [graph]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

  const saveDraft = useMutation({
    mutationFn: async (note?: string) => {
      const payload = {
        key: FLOW_KEY,
        branch_id: branchId,
        name: 'Inbound assistant',
        graph: graph as never,
        status: 'draft',
      };
      if (flow?.id) {
        const { error } = await supabase.from('agent_flows').update(payload).eq('id', flow.id);
        if (error) throw error;
        const { error: vErr } = await supabase.from('agent_flow_versions').insert([{
          flow_id: flow.id, version: (flow.version ?? 1) + 1, graph: payload.graph as never, note: note ?? null,
        }] as never);
        if (vErr) throw vErr;
        const { error: bump } = await supabase.from('agent_flows').update({ version: (flow.version ?? 1) + 1 }).eq('id', flow.id);
        if (bump) throw bump;
      } else {
        const { error } = await supabase.from('agent_flows').insert([payload] as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setDirty(false);
      toast.success('Workflow saved');
      queryClient.invalidateQueries({ queryKey: ['agent-flow', FLOW_KEY, branchId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save the workflow'),
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!flow?.id) throw new Error('Save the workflow before publishing.');
      const { error } = await supabase
        .from('agent_flows')
        .update({
          published_graph: graph as never,
          graph: graph as never,
          published_at: new Date().toISOString(),
          status: 'published',
          is_active: true,
        })
        .eq('id', flow.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setDirty(false);
      toast.success('Workflow is live');
      queryClient.invalidateQueries({ queryKey: ['agent-flow', FLOW_KEY, branchId] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not publish the workflow'),
  });

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true, style: { strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
      setDirty(true);
    },
    [setEdges],
  );

  const addNode = (kind: FlowNodeKind) => {
    const id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    const catalog = NODE_CATALOG.find((n) => n.kind === kind)!;
    const center = rfRef.current?.screenToFlowPosition
      ? rfRef.current.screenToFlowPosition({ x: window.innerWidth / 2, y: 320 })
      : { x: 400, y: 320 };
    setNodes((ns) => [...ns, { id, type: kind, position: center, data: { label: catalog.label } }]);
    setDirty(true);
  };

  const handleNodeSave = (nodeId: string, data: FlowNodeData) => {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data } : n)));
    setDirty(true);
  };

  const handleNodeDelete = (nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setDirty(true);
  };

  const revert = () => {
    const graphToLoad = flow?.published_graph?.nodes?.length
      ? flow.published_graph
      : flow?.graph?.nodes?.length
      ? flow.graph
      : defaultFlowGraph();
    const { nodes: n, edges: e } = toReactFlow(graphToLoad);
    setNodes(n); setEdges(e); setDirty(false);
    toast.success('Back to the last published version');
  };

  const restoreVersion = (g: FlowGraph) => {
    const { nodes: n, edges: e } = toReactFlow(g);
    setNodes(n); setEdges(e); setDirty(true); setHistoryOpen(false);
    toast.success('Version loaded — save to keep it');
  };

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardHeader><Skeleton className="h-6 w-56" /></CardHeader>
        <CardContent><Skeleton className="h-[520px] w-full rounded-2xl" /></CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="rounded-full bg-red-50 p-3 text-red-600"><AlertTriangle className="h-6 w-6" /></span>
          <p className="text-sm text-slate-600">We could not load the workflow. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-0 shadow-lg shadow-slate-200/50">
      <CardHeader className="gap-3 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              Visual flow builder
              {flow?.is_active ? (
                <Badge className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Live</Badge>
              ) : (
                <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Draft</Badge>
              )}
              {dirty && <Badge className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100">Unsaved changes</Badge>}
            </CardTitle>
            <CardDescription>
              Drag steps on to the canvas, join them up and open any step to change what it does.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={() => setHistoryOpen(true)} disabled={!flow?.id}>
              <History className="h-4 w-4" /> History
            </Button>
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={revert} disabled={!canEdit}>
              <RotateCcw className="h-4 w-4" /> Revert
            </Button>
            <Button size="sm" variant="outline" className="gap-2 rounded-xl" disabled={!canEdit || saveDraft.isPending} onClick={() => saveDraft.mutate(undefined)}>
              {saveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
            </Button>
            <Button size="sm" className="gap-2 rounded-xl" disabled={!canEdit || errorCount > 0 || publish.isPending} onClick={() => setPublishOpen(true)}>
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Publish
            </Button>
          </div>
        </div>

        {issues.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {issues.slice(0, 4).map((issue, i) => (
              <span
                key={i}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  issue.level === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {issue.message}
              </span>
            ))}
          </div>
        )}
        {issues.length === 0 && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Ready to publish
          </span>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row">
          {/* Palette */}
          <aside className="shrink-0 border-b border-slate-100 p-4 lg:w-64 lg:border-b-0 lg:border-r">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Add a step</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {NODE_CATALOG.map((item) => {
                const tone = TONE_STYLES[toneForKind(item.kind)];
                return (
                  <button
                    key={item.kind}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => addNode(item.kind)}
                    aria-label={`Add ${item.label}`}
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${tone.card}`}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
                      <span className="block truncate text-[11px] text-slate-500">{item.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Canvas */}
          <div className="h-[560px] flex-1 bg-slate-50">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type !== 'select' && x.type !== 'dimensions')) setDirty(true); }}
              onEdgesChange={(c) => { onEdgesChange(c); setDirty(true); }}
              onConnect={onConnect}
              onInit={(inst) => { rfRef.current = inst; }}
              onNodeDoubleClick={(_, node) => {
                setEditing({ id: node.id, type: (node.type ?? 'end') as FlowNodeKind, position: node.position, data: node.data as FlowNodeData });
                setDrawerOpen(true);
              }}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              edgesReconnectable={canEdit}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#cbd5e1" />
              <Controls className="rounded-xl border-0 shadow-lg" showInteractive={false} />
              <MiniMap pannable zoomable className="!rounded-xl !border-0 !shadow-lg" />
            </ReactFlow>
          </div>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Double-click any step to change its settings. Drag from the dot on one step to another to connect them.
        </p>
      </CardContent>

      <NodeSettingsDrawer
        node={editing}
        open={drawerOpen}
        readOnly={!canEdit}
        onOpenChange={setDrawerOpen}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />

      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Make this workflow live?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on the assistant follows these steps for new messages. You can revert at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl" onClick={() => publish.mutate()}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <AlertDialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Saved versions</AlertDialogTitle>
            <AlertDialogDescription>Load an earlier version of this workflow.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            {(versions ?? []).length === 0 && <p className="py-6 text-center text-sm text-slate-500">No earlier versions yet.</p>}
            {(versions ?? []).map((v: { id: string; version: number; created_at: string; note: string | null; graph: unknown }) => (
              <div key={v.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Version {v.version}</p>
                  <p className="truncate text-xs text-slate-500">{new Date(v.created_at).toLocaleString()}{v.note ? ` · ${v.note}` : ''}</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => restoreVersion(v.graph as FlowGraph)}>Load</Button>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function AgentFlowBuilder() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
