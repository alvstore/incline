import { useQuery } from '@tanstack/react-query';
import { Check, Flame } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const istKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** Monday-start IST week, as YYYY-MM-DD keys. */
function currentIstWeek(): string[] {
  const todayKey = istKey(new Date());
  const today = new Date(`${todayKey}T00:00:00Z`);
  const offset = (today.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - offset + i);
    return d.toISOString().slice(0, 10);
  });
}

export function StreakBanner({ memberId }: { memberId: string }) {
  const week = currentIstWeek();
  const todayKey = istKey(new Date());
  const { data: visited, isLoading, isError } = useQuery({
    queryKey: ['member-app-week-visits', memberId, week[0]],
    queryFn: async () => {
      const from = new Date(`${week[0]}T00:00:00+05:30`).toISOString();
      const { data, error } = await supabase.from('member_attendance').select('check_in')
        .eq('member_id', memberId).gte('check_in', from).limit(100);
      if (error) throw error;
      return new Set((data ?? []).map(r => istKey(new Date(r.check_in))));
    },
  });

  const count = visited ? week.filter(k => visited.has(k)).length : 0;

  return (
    <section aria-label="This week's visits" className="rounded-2xl bg-card p-5 shadow-lg shadow-slate-200/50 dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">This week</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{isLoading ? '…' : count} <span className="text-sm font-medium text-muted-foreground">/ 7 visits</span></p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Flame className="h-4 w-4" aria-hidden />{count >= 4 ? 'On fire' : count >= 2 ? 'Building momentum' : 'Let’s go'}
        </span>
      </div>
      {isError ? <p className="mt-4 text-sm text-muted-foreground">Couldn’t load your visits right now.</p> : (
        <ol className="mt-4 grid grid-cols-7 gap-1.5">
          {week.map((key, i) => {
            const done = visited?.has(key);
            const isToday = key === todayKey;
            return (
              <li key={key} className="flex flex-col items-center gap-1.5">
                <span className={`text-[11px] font-semibold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{DAYS[i]}</span>
                {isLoading ? <Skeleton className="h-10 w-10 rounded-full" /> : (
                  <span aria-label={`${key}${done ? ' visited' : ''}`} className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold transition-colors duration-200 ${done ? 'bg-theme-gradient text-white shadow-md shadow-primary/30' : isToday ? 'border-2 border-dashed border-primary/50 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {done ? <Check className="h-4 w-4" aria-hidden /> : Number(key.slice(8))}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
