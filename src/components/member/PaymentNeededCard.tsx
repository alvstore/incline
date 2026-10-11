import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, CreditCard } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface DebtLocks {
  mode: string;
  tier: 'red' | 'amber' | 'green';
  pt_due: number;
  store_due: number;
  addon_due: number;
  pt_locked: boolean;
  store_locked: boolean;
}

export function useMemberDebtLocks(memberId?: string) {
  return useQuery({
    queryKey: ['member-debt-locks', memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<DebtLocks> => {
      const { data, error } = await supabase.rpc('member_debt_locks', { _member_id: memberId! });
      if (error) throw error;
      return data as unknown as DebtLocks;
    },
    staleTime: 60_000,
  });
}

const inr = (n: number) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

/** Shows only when PT / store / add-on bills are overdue (gate still opens). */
export function PaymentNeededCard({ memberId }: { memberId?: string }) {
  const { data } = useMemberDebtLocks(memberId);
  if (!data || data.mode !== 'enforce') return null;
  const items = [
    ['Personal training', data.pt_due],
    ['Store', data.store_due],
    ['Add-ons', data.addon_due],
  ].filter(([, v]) => Number(v) > 0) as [string, number][];
  if (!items.length) return null;

  const locked = [data.pt_locked && 'new PT bookings', data.store_locked && 'shop & add-on purchases'].filter(Boolean).join(' and ');

  return (
    <section role="status" className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div>
          <p className="font-semibold text-foreground">Payment needed</p>
          <p className="text-sm text-muted-foreground">
            {items.map(([k, v]) => `${k} ${inr(v)}`).join(' · ')} overdue. Your club entry is not affected
            {locked ? `; ${locked} are paused until it's paid.` : '.'}
          </p>
        </div>
      </div>
      <Button asChild className="min-h-[44px] shrink-0">
        <Link to="/my-invoices"><CreditCard className="mr-2 h-4 w-4" aria-hidden /> Pay now</Link>
      </Button>
    </section>
  );
}
