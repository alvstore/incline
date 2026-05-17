import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ClipboardCheck } from 'lucide-react';
import { PtPackageBadge } from '@/components/pt/PtPackageBadge';
import { MarkPtStatusMenu } from '@/components/pt/MarkPtStatusMenu';

interface TrainerTodayPanelProps {
  trainerId: string;
  ptClients: any[];
}

/**
 * Compact trainer-side panel: lists active PT clients with a status picker
 * (Present / Late / Absent / Holiday) calling log_pt_session atomically.
 * Present + Late also create today's gym check-in if the member hasn't yet.
 */
export function TrainerTodayPanel({ trainerId, ptClients }: TrainerTodayPanelProps) {
  if (!ptClients || ptClients.length === 0) return null;

  return (
    <Card className="rounded-2xl border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Mark Today's PT Sessions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ptClients.map((client: any) => {
          const name = client.member?.profile?.full_name || client.member?.member_code || 'Unknown';
          const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
          const pkgType = (client.package_type ?? client.package?.package_type ?? 'session_based') as 'session_based' | 'monthly';

          return (
            <div
              key={client.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={client.member?.profile?.avatar_url} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-slate-900">{name}</p>
                <p className="text-xs text-muted-foreground truncate">{client.package?.name}</p>
              </div>
              <PtPackageBadge
                packageType={pkgType}
                sessionsRemaining={client.sessions_remaining}
                sessionsTotal={client.sessions_total}
                expiryDate={client.expiry_date}
              />
              <MarkPtStatusMenu
                memberPackageId={client.id}
                trainerId={trainerId}
                memberName={name}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
