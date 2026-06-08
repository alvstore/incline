import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

interface PolicyAuditRow {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
  select_policies: number;
  insert_policies: number;
  update_policies: number;
  delete_policies: number;
}

export function PolicyAuditCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['policy-audit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_audit' as any)
        .select('*')
        .order('table_name');
      if (error) throw error;
      return (data || []) as unknown as PolicyAuditRow[];
    },
    staleTime: 60_000,
  });

  const total = data?.length ?? 0;
  const noRls = data?.filter((r) => !r.rls_enabled) ?? [];
  const noPolicies = data?.filter((r) => r.rls_enabled && r.policy_count === 0) ?? [];
  const healthy = total - noRls.length - noPolicies.length;

  return (
    <Card className="rounded-2xl shadow-lg shadow/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-primary" />
          RLS Policy Audit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Healthy" value={healthy} tone="ok" />
              <Stat label="No RLS" value={noRls.length} tone={noRls.length ? 'bad' : 'ok'} />
              <Stat
                label="RLS, no policy"
                value={noPolicies.length}
                tone={noPolicies.length ? 'warn' : 'ok'}
              />
            </div>

            {noRls.length > 0 && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" /> Tables without RLS
                </div>
                <div className="flex flex-wrap gap-1">
                  {noRls.slice(0, 12).map((r) => (
                    <Badge key={r.table_name} variant="destructive" className="text-[10px]">
                      {r.table_name}
                    </Badge>
                  ))}
                  {noRls.length > 12 && (
                    <span className="text-xs text-destructive">+{noRls.length - 12} more</span>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {total} public tables audited.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok'
      ? 'text-success bg-success/10'
      : tone === 'warn'
      ? 'text-warning bg-warning/10'
      : 'text-destructive bg-destructive/10';
  return (
    <div className={`rounded-lg p-3 ${color}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-wider">{label}</div>
    </div>
  );
}
