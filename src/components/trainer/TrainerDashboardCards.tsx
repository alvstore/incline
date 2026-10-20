import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, CalendarDays, CheckCircle2, Clock, Dumbbell, ScanLine, Users, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTime12, istDateKey, istTimeKey, labelForDateKey, CLASS_CATEGORIES } from '@/lib/classes/schedule';
import { groupClassesByDay, initials } from '@/lib/trainers/dashboard';

export function MemberFace({ name, url, className }: { name?: string | null; url?: string | null; className?: string }) {
  return (
    <Avatar className={cn('h-10 w-10 shrink-0', className)}>
      {url ? <AvatarImage src={url} alt={name ?? 'Member'} className="object-cover" /> : null}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function CardShell({ icon: Icon, title, action, children, className }: { icon: any; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('rounded-xl border border-border', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span className="mb-3 rounded-full bg-muted p-3 text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ───────────── Today's sessions ───────────── */
export function TodaySessionsCard({ trainerId, sessions }: { trainerId: string; sessions: any[] }) {
  const today = istDateKey(new Date());
  // Which of today's sessions were created by the gate (auto attendance)?
  const { data: autoIds } = useQuery({
    queryKey: ['pt-auto-log-today', trainerId, today],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('pt_auto_attendance_log')
        .select('pt_session_id')
        .eq('trainer_id', trainerId)
        .eq('session_date', today);
      return new Set((data ?? []).map((r: any) => r.pt_session_id).filter(Boolean) as string[]);
    },
  });

  return (
    <CardShell icon={Clock} title="Today's sessions">
      {sessions.length === 0 ? (
        <Empty icon={Calendar} text="No PT sessions today yet. Gate check-ins appear here automatically." />
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const pkg = s.member_pt_packages;
            const m = pkg?.members;
            const name = m?.profiles?.full_name || m?.member_code || 'Member';
            const time = formatTime12(istTimeKey(s.scheduled_at));
            const auto = autoIds?.has(s.id);
            const done = s.status === 'completed';
            const missed = ['no_show', 'absent', 'cancelled'].includes(s.status);
            const state = done
              ? { label: 'Attended', icon: CheckCircle2, cls: 'bg-success/10 text-success border-success/20' }
              : missed
                ? { label: 'Missed', icon: XCircle, cls: 'bg-destructive/10 text-destructive border-destructive/20' }
                : { label: 'Upcoming', icon: Clock, cls: 'bg-muted text-muted-foreground border-border' };
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60">
                <MemberFace name={name} url={m?.profiles?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {auto ? (
                      <span className="inline-flex items-center gap-1"><ScanLine className="h-3 w-3" />Checked in {time} · auto-marked by gate</span>
                    ) : done ? `Logged ${time}` : `Booked ${time}`}
                    {pkg?.package?.name ? ` · ${pkg.package.name}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className={cn('shrink-0 gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', state.cls)}>
                  <state.icon className="h-3 w-3" />{state.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}

/* ───────────── My clients ───────────── */
function daysUntil(date?: string | null) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function MyClientsCard({ ptClients, generalClients }: { ptClients: any[]; generalClients: any[] }) {
  const empty = ptClients.length === 0 && generalClients.length === 0;
  return (
    <CardShell
      icon={Users}
      title="My clients"
      action={<Button variant="ghost" size="sm" className="rounded-lg" asChild><Link to="/my-clients">View all</Link></Button>}
    >
      {empty ? <Empty icon={Users} text="No clients assigned yet" /> : (
        <div className="space-y-4">
          {ptClients.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal training · {ptClients.length}</p>
              <ul className="space-y-1">
                {ptClients.slice(0, 5).map((c) => {
                  const name = c.member?.profile?.full_name || c.member?.member_code;
                  const left = daysUntil(c.expiry_date);
                  const soon = left !== null && left <= 7;
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60">
                      <MemberFace name={name} url={c.member?.profile?.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.package?.name}</p>
                      </div>
                      {c.expiry_date && (
                        <Badge variant="outline" className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          soon ? 'bg-warning/10 text-warning border-warning/20' : 'bg-muted text-muted-foreground border-border')}>
                          {left !== null && left < 0 ? 'Expired' : `Ends ${new Date(c.expiry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {generalClients.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">General training · {generalClients.length}</p>
              <ul className="space-y-1">
                {generalClients.slice(0, 5).map((c) => {
                  const name = c.profile?.full_name || c.member_code;
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60">
                      <MemberFace name={name} url={c.profile?.avatar_url} />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

/* ───────────── My upcoming classes (date first) ───────────── */
const categoryLabel = (v?: string | null) =>
  CLASS_CATEGORIES.find((c) => c.value === v && v !== 'other')?.label ?? null;

export function TrainerClassDays({ classes }: { classes: any[] }) {
  const days = useMemo(() => groupClassesByDay(classes), [classes]);
  const todayKey = days[0]?.key ?? istDateKey(new Date());
  const firstWithClasses = days.find((d) => d.items.length)?.key ?? todayKey;
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? firstWithClasses;
  const day = days.find((d) => d.key === active);

  return (
    <CardShell
      icon={CalendarDays}
      title="My upcoming classes"
      className="lg:col-span-12"
      action={<Button variant="ghost" size="sm" className="rounded-lg" asChild><Link to="/classes">All classes</Link></Button>}
    >
      <div role="tablist" aria-label="Pick a day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const on = d.key === active;
          const [, , dd] = d.key.split('-');
          return (
            <button
              key={d.key}
              role="tab"
              aria-selected={on}
              onClick={() => setPicked(d.key)}
              className={cn(
                'flex min-h-[44px] min-w-[72px] shrink-0 cursor-pointer flex-col items-center rounded-xl border px-3 py-2 text-center transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-secondary',
              )}
            >
              <span className={cn('text-[11px] font-semibold uppercase tracking-wide', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {labelForDateKey(d.key, todayKey).split(',')[0]}
              </span>
              <span className="text-lg font-bold tabular-nums">{Number(dd)}</span>
              <span className={cn('text-[11px]', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {d.items.length ? `${d.items.length} class${d.items.length > 1 ? 'es' : ''}` : '—'}
              </span>
            </button>
          );
        })}
      </div>
      {!day || day.items.length === 0 ? (
        <Empty icon={Dumbbell} text="No classes on this day" />
      ) : (
        <ul className="mt-2 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {day.items.map((c) => {
            const cat = categoryLabel(c.class_type);
            const booked = c.bookings_count ?? c.booked_count ?? 0;
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors duration-150 hover:bg-secondary">
                <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-muted py-2">
                  <span className="text-sm font-bold tabular-nums">{formatTime12(istTimeKey(c.scheduled_at)).replace(/ (AM|PM)/, '')}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground">{formatTime12(istTimeKey(c.scheduled_at)).slice(-2)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.duration_minutes ?? 60} min{cat ? ` · ${cat}` : ''}{c.venue ? ` · ${c.venue}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {booked} / {c.capacity} booked
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </CardShell>
  );
}
