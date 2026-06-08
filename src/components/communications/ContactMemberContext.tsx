import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Activity, Loader2, CalendarCheck, Wallet, Dumbbell } from 'lucide-react';
import { format, formatDistanceToNow, differenceInDays } from 'date-fns';

interface Props {
  memberId: string;
  onInsert: (text: string) => void;
}

async function fetchMemberContext(memberId: string) {
  const [{ data: member }, { data: ms }, { data: lastAtt }] = await Promise.all([
    supabase.from('members').select('id, member_code, profiles:user_id(full_name)').eq('id', memberId).maybeSingle(),
    supabase.from('memberships').select('id, status, end_date, plan_id, membership_plans(name)').eq('member_id', memberId).order('end_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('member_attendance').select('check_in').eq('member_id', memberId).order('check_in', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { member, membership: ms as any, lastAttendance: lastAtt as any };
}

export function ContactMemberContext({ memberId, onInsert }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['chat-member-context', memberId],
    queryFn: () => fetchMemberContext(memberId),
    enabled: !!memberId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-muted/40 p-4 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const memberName = (data?.member as any)?.profiles?.full_name || 'Member';
  const firstName = memberName.split(' ')[0] || 'there';
  const ms = data?.membership;
  const planName = ms?.membership_plans?.name || 'Plan';
  const endDate = ms?.end_date ? new Date(ms.end_date) : null;
  const daysLeft = endDate ? differenceInDays(endDate, new Date()) : null;

  let badgeClass = 'bg-muted text-foreground border-border';
  let badgeText = 'No active plan';
  if (daysLeft !== null) {
    if (daysLeft < 0) { badgeClass = 'bg-destructive/15 text-destructive border-destructive/25'; badgeText = `Expired ${Math.abs(daysLeft)}d ago`; }
    else if (daysLeft <= 7) { badgeClass = 'bg-destructive/15 text-destructive border-destructive/25'; badgeText = `Expires in ${daysLeft}d`; }
    else if (daysLeft <= 30) { badgeClass = 'bg-warning/15 text-warning border-warning/25'; badgeText = `Expires in ${daysLeft}d`; }
    else { badgeClass = 'bg-success/15 text-success border-success/25'; badgeText = `${daysLeft}d remaining`; }
  }

  const lastCheckIn = data?.lastAttendance?.check_in ? new Date(data.lastAttendance.check_in) : null;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="space-y-4">
      {/* Membership card */}
      <div className="rounded-2xl bg-card p-4 shadow-md shadow/50">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-8 w-8 rounded-full bg-primary/15 dark:bg-primary/20 text-primary flex items-center justify-center">
            <CreditCard className="h-4 w-4" />
          </div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Membership</p>
        </div>
        <p className="font-semibold text-foreground text-sm">{planName}</p>
        {endDate && <p className="text-xs text-muted-foreground mt-0.5">Ends {format(endDate, 'dd MMM yyyy')}</p>}
        <Badge variant="outline" className={`${badgeClass} rounded-full text-[10px] mt-2`}>{badgeText}</Badge>
      </div>

      {/* Last attendance */}
      <div className="rounded-2xl bg-card p-4 shadow-md shadow/50">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-8 w-8 rounded-full bg-info/15 dark:bg-info/20 text-info flex items-center justify-center">
            <Activity className="h-4 w-4" />
          </div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Last Visit</p>
        </div>
        {lastCheckIn ? (
          <>
            <p className="font-semibold text-foreground text-sm">{format(lastCheckIn, 'dd MMM, HH:mm')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(lastCheckIn, { addSuffix: true })}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No check-ins recorded</p>
        )}
      </div>

      {/* Quick actions */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/10 dark:from-primary/10 dark:to-primary/10 p-4 shadow-sm shadow-primary/20 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Quick Actions</p>
        <Button
          size="sm"
          variant="outline"
          className="w-full rounded-xl gap-2 justify-start bg-card"
          onClick={() => onInsert(`Hi ${firstName}, please complete your payment here: ${baseUrl}/member/pay?member=${memberId}`)}
        >
          <Wallet className="h-3.5 w-3.5 text-success" /> Send Payment Link
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full rounded-xl gap-2 justify-start bg-card"
          onClick={() => onInsert(`Hi ${firstName}, ready to book your next PT session? Tap here: ${baseUrl}/pt-sessions`)}
        >
          <Dumbbell className="h-3.5 w-3.5 text-primary" /> Book PT Session
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full rounded-xl gap-2 justify-start bg-card"
          onClick={() => onInsert(`Hi ${firstName}, book your facility slot here: ${baseUrl}/my-classes`)}
        >
          <CalendarCheck className="h-3.5 w-3.5 text-info" /> Book Facility Slot
        </Button>
      </div>
    </div>
  );
}
