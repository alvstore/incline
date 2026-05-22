import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, X } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { type AutomationRule, type AutomationRun, STATUS_COLOR } from './types';

interface Props {
  runs: AutomationRun[];
  rules: AutomationRule[];
  filterRuleId: string | null;
  onClearFilter: () => void;
}

export function AutomationActivityRail({ runs, rules, filterRuleId, onClearFilter }: Props) {
  const qc = useQueryClient();

  // Realtime subscription so the rail updates as runs land.
  useEffect(() => {
    const ch = supabase
      .channel('automation-runs-rail')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_runs' }, () => {
        qc.invalidateQueries({ queryKey: ['automation-runs-recent'] });
        qc.invalidateQueries({ queryKey: ['automation-rules'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filteredRuns = filterRuleId ? runs.filter((r) => r.rule_id === filterRuleId) : runs;
  const filterRule = filterRuleId ? rules.find((r) => r.id === filterRuleId) : null;

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0 sticky top-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-600" /> Activity
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono">live</Badge>
        </div>
        {filterRule && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-slate-500">Filtering:</span>
            <Badge className="bg-indigo-100 text-indigo-700 gap-1 hover:bg-indigo-100">
              {filterRule.name}
              <button onClick={onClearFilter} aria-label="Clear filter" className="ml-1 hover:text-indigo-900">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 max-h-[600px] overflow-y-auto">
        {filteredRuns.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {filteredRuns.slice(0, 50).map((r) => {
              const rule = rules.find((x) => x.id === r.rule_id);
              return (
                <li key={r.id} className="py-2.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`${STATUS_COLOR[r.status] ?? STATUS_COLOR.skipped} text-xs`}>{r.status}</Badge>
                    <span className="font-medium text-slate-700 flex-1 truncate text-xs">
                      {rule?.name ?? r.rule_id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {format(new Date(r.started_at), 'HH:mm:ss')}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 pl-1 flex items-center gap-2 flex-wrap">
                    <span>{r.dispatched_count} dispatched</span>
                    {r.error_message && (
                      <span className="text-rose-600 truncate max-w-full" title={r.error_message}>
                        {r.error_message}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
