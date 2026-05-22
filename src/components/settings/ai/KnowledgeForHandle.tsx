// Read-only list of ai_knowledge rows scoped to a single purpose.
// Used inside the Handle card so authors can see which facts the handle uses.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Brain, ExternalLink } from 'lucide-react';

interface KnowledgeForHandleProps {
  purpose: string;
  onOpenKnowledge?: () => void;
}

interface Row {
  id: string;
  title: string;
  topic: string;
  priority: number;
  is_active: boolean;
  branch_id: string | null;
}

export function KnowledgeForHandle({ purpose, onOpenKnowledge }: KnowledgeForHandleProps) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['ai_knowledge_for_handle', purpose],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_knowledge')
        .select('id, title, topic, priority, is_active, branch_id, applies_to')
        .eq('is_active', true)
        .order('priority', { ascending: true });
      if (error) throw error;
      // applies_to is a text[] — filter client-side to handle 'all' OR purpose match
      return ((data ?? []) as any[])
        .filter((r) => Array.isArray(r.applies_to) && (r.applies_to.includes('all') || r.applies_to.includes(purpose)))
        .map((r) => ({ id: r.id, title: r.title, topic: r.topic, priority: r.priority, is_active: r.is_active, branch_id: r.branch_id })) as Row[];
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Brain className="h-4 w-4 text-violet-600" />
          Knowledge available to this handle
          {rows && <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{rows.length}</Badge>}
        </div>
        {onOpenKnowledge && (
          <Button variant="ghost" size="sm" onClick={onOpenKnowledge} className="gap-1 text-indigo-600">
            <ExternalLink className="h-3.5 w-3.5" /> Manage Knowledge
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-center text-xs text-slate-500">
          No knowledge entries apply to this handle yet. Add facts, offers, FAQs or behavioural rules in
          the <b>Knowledge</b> tab and scope them to <code className="font-mono">{purpose}</code> or{' '}
          <code className="font-mono">all</code>.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <Badge
              key={r.id}
              variant="outline"
              className="bg-white text-xs gap-1 max-w-[260px] truncate"
              title={`${r.topic} · priority ${r.priority}`}
            >
              <span className="text-slate-400 text-[10px]">{r.topic}</span>
              <span className="truncate">{r.title}</span>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
