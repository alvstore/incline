import { Card, CardContent } from '@/components/ui/card';
import { Users, UserPlus, Phone, Target, TrendingUp, X, Flame, Sun, Snowflake, UserX, Clock } from 'lucide-react';

interface LeadDashboardProps {
  stats: {
    total: number;
    new: number;
    contacted: number;
    qualified: number;
    negotiation: number;
    converted: number;
    lost: number;
    hot: number;
    warm: number;
    cold: number;
    unassigned: number;
    overdue?: number;
  };
}

export function LeadDashboard({ stats }: LeadDashboardProps) {
  const conversionRate = stats.total > 0
    ? Math.round((stats.converted / stats.total) * 100)
    : 0;

  const statCards = [
    { label: 'Total Leads', value: stats.total, icon: Users, gradient: true },
    { label: 'New', value: stats.new, icon: UserPlus },
    { label: 'Contacted', value: stats.contacted, icon: Phone },
    { label: 'Qualified', value: stats.qualified, icon: Target },
    { label: 'Converted', value: stats.converted, icon: TrendingUp, suffix: `(${conversionRate}%)` },
    { label: 'Lost', value: stats.lost, icon: X },
  ];

  const tempCards = [
    { label: 'Hot', value: stats.hot, icon: Flame, color: 'text-destructive' },
    { label: 'Warm', value: stats.warm, icon: Sun, color: 'text-warning' },
    { label: 'Cold', value: stats.cold, icon: Snowflake, color: 'text-info' },
    { label: 'Unassigned', value: stats.unassigned, icon: UserX, color: 'text-muted-foreground' },
    ...(stats.overdue !== undefined ? [{ label: 'Overdue', value: stats.overdue, icon: Clock, color: 'text-destructive' }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-6">
        {statCards.map((stat) => (
          <Card
            key={stat.label}
            className={
              stat.gradient
                ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground border-0 shadow-lg shadow-primary/20 rounded-2xl'
                : 'rounded-2xl border-border/50 shadow-lg shadow-primary/5'
            }
          >
            <CardContent className="pt-4 pb-3 px-4">
              <stat.icon className={`h-4 w-4 mb-1.5 ${stat.gradient ? 'opacity-80' : 'text-muted-foreground'}`} />
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold ${stat.gradient ? '' : 'text-foreground'}`}>{stat.value}</span>
                {stat.suffix && <span className={`text-xs ${stat.gradient ? 'opacity-70' : 'text-muted-foreground'}`}>{stat.suffix}</span>}
              </div>
              <p className={`text-xs mt-0.5 ${stat.gradient ? 'opacity-80' : 'text-muted-foreground'}`}>{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 grid-cols-5">
        {tempCards.map((stat) => (
          <Card key={stat.label} className="rounded-xl border-border/50 shadow-sm">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
              <div>
                <span className="text-lg font-bold text-foreground">{stat.value}</span>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
