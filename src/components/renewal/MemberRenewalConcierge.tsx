import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMemberConcierge } from '@/hooks/useMemberConcierge';
import { extendedEndDate, formatDate, formatINR } from '@/lib/renewal/conciergePricing';
import type { ConciergePlanOption, ConciergePtOption, ConciergeSelection } from '@/types/concierge';
import { ConciergeHero } from './ConciergeHero';
import { MembershipRenewCard } from './MembershipRenewCard';
import { PtTopUpPanel } from './PtTopUpPanel';
import { ConciergeCheckoutDrawer } from './ConciergeCheckoutDrawer';

/** The member-facing Renewal Concierge. */
export function MemberRenewalConcierge() {
  const {
    member, memberName, activeMembership, daysRemaining,
    currentPlan, upgradePlan, plans, ptOptions, ptBalance,
    payableInvoice, requestCheckout, isLoading, isError, refetch,
  } = useMemberConcierge();

  const [selection, setSelection] = useState<ConciergeSelection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const membership = activeMembership as { end_date?: string; plan?: { name?: string } } | null;
  const endDate = membership?.end_date ?? null;
  const planName = currentPlan?.name ?? membership?.plan?.name ?? null;
  const renewPlan = currentPlan ?? plans[0] ?? null;

  const openPlan = (plan: ConciergePlanOption) => {
    setSelection({
      kind: 'membership',
      id: plan.id,
      name: plan.name,
      price: plan.price,
      gstRate: plan.gstRate,
      gstInclusive: plan.gstInclusive,
      detail: `${plan.durationDays} days · valid through ${formatDate(extendedEndDate(endDate, plan.durationDays))}`,
    });
    setDrawerOpen(true);
  };

  const openPt = (option: ConciergePtOption) => {
    setSelection({
      kind: 'pt',
      id: option.id,
      name: option.name,
      price: option.price,
      gstRate: option.gstRate,
      gstInclusive: option.gstInclusive,
      detail: `${option.sessions} sessions · valid ${option.validityDays} days`,
    });
    setDrawerOpen(true);
  };

  const confirm = (item: ConciergeSelection) => {
    requestCheckout.mutate(item, {
      onSuccess: () => {
        setDrawerOpen(false);
        toast.success('Sent to the front desk — your payment link is on its way.');
      },
      onError: (error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'We could not send that request.');
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isError || !member) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-12 shadow-lg shadow-slate-200/50 text-center">
        <AlertCircle className="h-6 w-6 text-red-500" aria-hidden />
        <p className="text-sm tracking-wide text-slate-900">We could not load your membership right now.</p>
        <Button onClick={refetch} className="cursor-pointer rounded-2xl">Try again</Button>
      </div>
    );
  }

  const memberRow = member as { member_code?: string; branch?: { name?: string } };

  return (
    <div className="space-y-8">
      <ConciergeHero
        memberName={memberName}
        memberCode={memberRow.member_code ?? null}
        branchName={memberRow.branch?.name ?? null}
        planName={planName}
        endDate={endDate}
        daysRemaining={daysRemaining}
        hasMembership={Boolean(activeMembership)}
        ptRemaining={ptBalance.remaining}
        ptTotal={ptBalance.total}
        trainerName={ptBalance.trainer}
      />

      {payableInvoice && (
        <div className="flex flex-col gap-4 rounded-2xl bg-amber-50 p-6 shadow-lg shadow-amber-100/50 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="text-sm font-medium tracking-wide text-slate-900">
                Invoice {payableInvoice.invoiceNumber} is waiting
              </p>
              <p className="text-xs tracking-wide text-slate-500">
                {formatINR(payableInvoice.balance)} outstanding{payableInvoice.dueDate ? ` · due ${formatDate(payableInvoice.dueDate)}` : ''}
              </p>
            </div>
          </div>
          <Button asChild className="h-12 cursor-pointer rounded-2xl bg-theme-gradient px-6 text-sm font-semibold text-white hover:opacity-90">
            <Link to={`/member/pay?invoice=${payableInvoice.id}`}>Pay via UPI / Card</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Extend your access</h2>
          </div>
          {renewPlan ? (
            <MembershipRenewCard
              plan={renewPlan}
              variant="renew"
              ctaLabel={activeMembership ? 'Renew membership' : 'Activate membership'}
              footnote={`Extends you to ${formatDate(extendedEndDate(endDate, renewPlan.durationDays))}`}
              onSelect={openPlan}
            />
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm tracking-wide text-slate-500">
              No plans are published for your club yet. Please speak to the front desk.
            </p>
          )}
          {upgradePlan && (
            <MembershipRenewCard
              plan={upgradePlan}
              variant="upgrade"
              ctaLabel={`Upgrade to ${upgradePlan.name}`}
              onSelect={openPlan}
            />
          )}
        </div>

        <PtTopUpPanel
          options={ptOptions}
          trainerName={ptBalance.trainer}
          trainerAvatar={ptBalance.trainerAvatar}
          remaining={ptBalance.remaining}
          hasPackage={ptBalance.hasPackage}
          onSelect={openPt}
        />
      </div>

      <ConciergeCheckoutDrawer
        selection={selection}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        payableInvoice={payableInvoice}
        submitting={requestCheckout.isPending}
        onConfirm={confirm}
      />
    </div>
  );
}

export default MemberRenewalConcierge;
