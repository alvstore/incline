import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberFace } from '@/components/trainer/TrainerDashboardCards';
import { ClientBriefSheet, type BriefTarget } from '@/components/trainer/ClientBriefSheet';
import { goalList, healthFlags, type ClientBrief } from '@/lib/trainers/clientBrief';
import { cn } from '@/lib/utils';

interface PtClient { id: string; member_id?: string; expiry_date?: string | null; package?: { name?: string | null } | null; member?: { id?: string; member_code?: string | null; profile?: { full_name?: string | null; avatar_url?: string | null } | null } | null }
interface GeneralClient { id: string; member_code?: string | null; profile?: { full_name?: string | null; avatar_url?: string | null } | null }

function daysUntil(d?: string | null) { return d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null; }

export function ClientRail({ ptClients, generalClients, briefs, loading }: {
  ptClients: PtClient[]; generalClients: GeneralClient[]; briefs?: Record<string, ClientBrief>; loading?: boolean;
}) {
  const [target, setTarget] = useState<BriefTarget | null>(null);
  const rows: (BriefTarget & { pt: boolean })[] = [
    ...ptClients.map((c) => ({
      memberId: c.member_id ?? c.member?.id ?? c.id,
      name: c.member?.profile?.full_name || c.member?.member_code || 'Member',
      avatarUrl: c.member?.profile?.avatar_url, packageName: c.package?.name, expiry: c.expiry_date, pt: true,
    })),
    ...generalClients.map((c) => ({ memberId: c.id, name: c.profile?.full_name || c.member_code || 'Member', avatarUrl: c.profile?.avatar_url, pt: false })),
  ];
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.memberId) ? false : (seen.add(r.memberId), true)));

  return (
    <Card className="rounded-2xl border border-border">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-xl font-semibold tracking-tight">My clients</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">Tap a client to see their goals</p>
        </div>
        <Button variant="ghost" size="sm" asChild className="rounded-lg"><Link to="/my-clients">View all</Link></Button>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
        ) : unique.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="mb-3 rounded-full bg-muted p-3 text-muted-foreground"><Users className="h-5 w-5" /></span>
            <p className="text-sm text-muted-foreground">No clients assigned yet</p>
          </div>
        ) : (
          <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {unique.slice(0, 12).map((r) => {
              const b = briefs?.[r.memberId];
              const goal = goalList(b?.fitness_goals)[0];
              const flagged = healthFlags(b?.health_conditions).length > 0;
              const left = daysUntil(r.expiry);
              return (
                <li key={r.memberId}>
                  <button
                    type="button"
                    onClick={() => setTarget(r)}
                    className="flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-xl p-2 text-left transition-colors duration-150 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MemberFace name={r.name} url={r.avatarUrl} className="h-11 w-11 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-foreground">{r.name}</span>
                        {flagged && <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-warning"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Health note</span>}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {goal ? (
                          <Badge variant="outline" className="rounded-full border-accent/20 bg-accent/10 px-2 py-0 text-[11px] text-accent">{goal}</Badge>
                        ) : <span className="text-xs text-muted-foreground">No goal shared</span>}
                        {r.pt && left !== null && (
                          <span className={cn('truncate text-[11px]', left <= 7 ? 'text-warning' : 'text-muted-foreground')}>
                            {left < 0 ? 'PT expired' : `PT · ${left}d left`}
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ClientBriefSheet target={target} brief={target ? briefs?.[target.memberId] : undefined} onClose={() => setTarget(null)} />
    </Card>
  );
}
