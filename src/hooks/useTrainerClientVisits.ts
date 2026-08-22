import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ClientVisit {
  member_id: string;
  visit_date: string;
  first_seen: string;
  last_seen: string;
  scan_count: number;
}

export interface ClientVisitSummary {
  /** Most recent visits first, max 3. */
  recent: ClientVisit[];
  /** Average arrival time (minutes past midnight, IST) across the window. */
  typicalArrivalMinutes: number | null;
}

const IST = 'Asia/Kolkata';

function istMinutes(iso: string): number {
  const parts = new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: IST,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = parts.split(':').map(Number);
  return h * 60 + m;
}

export function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatIstDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: IST });
  if (dateStr === today) return 'Today';
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: IST });
}

export function formatMinutes(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Visit rhythm for the calling trainer's own clients, sourced from the
 * biometric turnstile feed via a security-definer RPC (trainers cannot read
 * attendance tables directly).
 */
export function useTrainerClientVisits(enabled: boolean, days = 7) {
  return useQuery({
    queryKey: ['trainer-client-visits', days],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, ClientVisitSummary>> => {
      const { data, error } = await supabase.rpc('get_trainer_client_visits', {
        p_days: days,
      } as never);
      if (error) throw error;

      const byMember: Record<string, ClientVisit[]> = {};
      ((data as unknown as ClientVisit[]) || []).forEach((row) => {
        (byMember[row.member_id] ||= []).push(row);
      });

      const out: Record<string, ClientVisitSummary> = {};
      Object.entries(byMember).forEach(([memberId, rows]) => {
        const sorted = [...rows].sort((a, b) => b.visit_date.localeCompare(a.visit_date));
        const mins = sorted.map((r) => istMinutes(r.first_seen));
        out[memberId] = {
          recent: sorted.slice(0, 3),
          typicalArrivalMinutes: mins.length
            ? Math.round(mins.reduce((s, m) => s + m, 0) / mins.length)
            : null,
        };
      });
      return out;
    },
  });
}
