import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Inbox, CheckCircle2, Clock3 } from 'lucide-react';

interface RequestsHeroProps {
  memberName: string;
  openCount: number;
  approvedCount: number;
  totalCount: number;
  onNewRequest: () => void;
}

export function RequestsHero({
  memberName,
  openCount,
  approvedCount,
  totalCount,
  onNewRequest,
}: RequestsHeroProps) {
  const stats = [
    { label: 'Open', value: openCount, icon: Clock3 },
    { label: 'Approved', value: approvedCount, icon: CheckCircle2 },
    { label: 'Total', value: totalCount, icon: Inbox },
  ];

  return (
    <Card className="overflow-hidden rounded-2xl border-border/60 shadow-lg shadow-primary/10">
      <CardContent className="grid gap-6 bg-gradient-to-r from-primary via-primary to-primary/90 p-6 text-primary-foreground md:grid-cols-[1.4fr_1fr] md:items-center">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
            Member services
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My Requests</h1>
          <p className="max-w-md text-sm text-primary-foreground/85">
            {openCount > 0
              ? `${memberName}, you have ${openCount} request${openCount > 1 ? 's' : ''} awaiting a response from the team.`
              : `${memberName}, raise a request and the front desk will pick it up from here.`}
          </p>
          <Button
            variant="secondary"
            className="mt-2 rounded-xl"
            onClick={onNewRequest}
            data-testid="btn-new-request"
          >
            <Plus className="mr-2 h-4 w-4" />
            New request
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl bg-card/10 p-4 backdrop-blur">
              <Icon className="h-4 w-4 text-primary-foreground/70" aria-hidden="true" />
              <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-primary-foreground/70">
                {label}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
