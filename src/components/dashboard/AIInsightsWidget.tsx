import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sparkles, RefreshCw, AlertTriangle, TrendingUp, Info, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Insight {
  icon: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'success' | 'critical';
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-info/10 text-info border-info/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  success: 'bg-success/10 text-success border-success/25',
  critical: 'bg-destructive/10 text-destructive border-destructive/20',
};

const SEVERITY_ICONS: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  success: TrendingUp,
  critical: AlertCircle,
};

export function AIInsightsWidget({ branchId }: { branchId?: string }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Hydrate persisted insights from DB (24h window) so they survive refresh.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsHydrating(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsHydrating(false); return; }
        let q = (supabase.from('ai_dashboard_insights') as any)
          .select('insights, generated_at, branch_id')
          .eq('user_id', user.id)
          .gte('generated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('generated_at', { ascending: false })
          .limit(1);
        if (branchId) q = q.eq('branch_id', branchId);
        else q = q.is('branch_id', null);
        const { data } = await q;
        if (!cancelled && data && data.length > 0) {
          setInsights((data[0].insights as Insight[]) || []);
          setGeneratedAt(data[0].generated_at);
        }
      } catch { /* silent */ }
      finally { if (!cancelled) setIsHydrating(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [branchId]);

  const persistInsights = async (newInsights: Insight[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const now = new Date().toISOString();
      await (supabase.from('ai_dashboard_insights') as any).insert({
        user_id: user.id,
        branch_id: branchId || null,
        insights: newInsights,
        generated_at: now,
      });
      setGeneratedAt(now);
    } catch (e) {
      console.warn('Failed to persist insights', e);
    }
  };

  const generateInsights = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-dashboard-insights', {
        body: { branch_id: branchId || null },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); return; }
      const newInsights: Insight[] = data?.insights || [];
      setInsights(newInsights);
      await persistInsights(newInsights);
      toast.success('AI insights generated!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate insights');
    } finally {
      setIsLoading(false);
    }
  };

  const updatedLabel = generatedAt
    ? `Updated ${formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}`
    : null;

  return (
    <Card className="shadow-lg rounded-2xl border-0 bg-gradient-to-br from-card to-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/10 to-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            AI Insights
          </CardTitle>
          <div className="flex items-center gap-2">
            {updatedLabel && (
              <span className="text-xs text-muted-foreground">{updatedLabel}</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={generateInsights}
              disabled={isLoading}
              className="rounded-xl gap-1.5"
            >
              {isLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {insights.length === 0 ? 'Generate' : 'Refresh'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || isHydrating ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
                <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : insights.length > 0 ? (
          <div className="space-y-2.5">
            {insights.map((insight, idx) => {
              const SeverityIcon = SEVERITY_ICONS[insight.severity] || Info;
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.info}`}
                >
                  <div className="text-xl flex-shrink-0 mt-0.5">{insight.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{insight.title}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">
                        {insight.severity}
                      </Badge>
                    </div>
                    <p className="text-xs mt-0.5 opacity-80">{insight.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/10 flex items-center justify-center mb-3">
              <Sparkles className="h-6 w-6 text-primary/50" />
            </div>
            <p className="text-sm text-muted-foreground">Click "Generate" to get AI-powered insights about your gym's performance</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
