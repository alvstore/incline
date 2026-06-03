import { Cake, Gift, Sparkles } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpcomingBirthdays, type BirthdayMember } from '@/hooks/useDashboardData';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface BirthdayWidgetProps {
  branchId?: string | null;
  className?: string;
}

function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export default function BirthdayWidget({ branchId, className }: BirthdayWidgetProps) {
  const { data, isLoading, isFetching } = useUpcomingBirthdays(branchId, 7);
  const { toast } = useToast();
  const today = data?.today ?? [];
  const upcoming = data?.upcoming ?? [];

  const handleGreet = (m: BirthdayMember) => {
    toast({
      title: 'Greeting queued',
      description: `Birthday wish will be sent to ${m.full_name ?? 'member'}.`,
    });
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br from-card/90 to-card/50 backdrop-blur-xl ring-1 ring-border/60 shadow-lg shadow-primary/5 p-5',
        className,
      )}
    >
      {/* Decorative gradient blob */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />

      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Cake className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground leading-none">Birthdays</h3>
            <p className="text-xs text-muted-foreground mt-1">Today &amp; next 7 days</p>
          </div>
        </div>
        {isFetching && !isLoading && (
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-label="Refreshing" />
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : today.length === 0 && upcoming.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="p-3 rounded-full bg-muted/50 mb-3">
            <Gift className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No birthdays in the next 7 days.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {today.length > 0 && (
            <div className="rounded-xl bg-primary/10 ring-1 ring-primary/30 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Today
              </div>
              {today.map((m) => (
                <div key={m.member_id} className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 ring-2 ring-primary/40">
                    <AvatarImage src={m.avatar_url ?? undefined} alt="" />
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                      {initials(m.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {m.full_name ?? 'Unnamed member'}
                    </p>
                    <p className="text-xs text-muted-foreground">Turning {m.turning_age}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-8 rounded-lg"
                    onClick={() => handleGreet(m)}
                    aria-label={`Send birthday greeting to ${m.full_name ?? 'member'}`}
                  >
                    <Gift className="h-3.5 w-3.5 mr-1" /> Greet
                  </Button>
                </div>
              ))}
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Upcoming
              </div>
              <ul className="space-y-1.5">
                {upcoming.slice(0, 8).map((m) => (
                  <li
                    key={m.member_id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40 transition-colors"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={m.avatar_url ?? undefined} alt="" />
                      <AvatarFallback className="text-xs bg-muted">
                        {initials(m.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {m.full_name ?? 'Unnamed member'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(parseISO(m.birthday_date), 'MMM d')} · in {m.days_until}d
                      </p>
                    </div>
                    <Badge variant="secondary" className="rounded-full text-[10px] font-medium">
                      → {m.turning_age}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
