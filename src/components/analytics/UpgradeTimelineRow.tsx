import { ArrowUpRight, Check, Clock, MessageCircle, CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { upgradeTimeLeft, upgradeWindowDay, upgradeElapsedPercent } from '../../../supabase/functions/_shared/upgradeWindow';
import { UpgradeMemberAvatar } from './UpgradeMemberAvatar';
import { explainCommError, isPacingError } from '@/lib/comms/metaErrorLabels';

export interface UpgradeTimelineOffer {
  id: string; member_id: string; member_name: string; member_code: string;
  status: string; plan_name: string | null; start_date: string; joined_at: string;
  window_ends_at: string; upgrade_cost: number | null;
  avatar_url?: string | null;
  reminders: Array<{ stage: 'd7' | 'd12'; status: string; timestamp: string | null; reason: string | null }>;
}
const date = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const timestamp = (value: string) => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const tones: Record<string, string> = { sent: 'bg-info/10 text-info', delivered: 'bg-success/10 text-success', read: 'bg-success/10 text-success', failed: 'bg-destructive/10 text-destructive', bounced: 'bg-destructive/10 text-destructive', suppressed: 'bg-muted text-muted-foreground', queued: 'bg-warning/10 text-foreground', sending: 'bg-warning/10 text-foreground' };

export function UpgradeTimelineRow({ offer, now, showRevenue }: { offer: UpgradeTimelineOffer; now: Date; showRevenue: boolean }) {
  const navigate = useNavigate();
  const left = upgradeTimeLeft(offer.window_ends_at, now);
  if (left.expired) return null;
  const day = upgradeWindowDay(offer.window_ends_at, now);
  const urgent = left.days <= 3;
  return (
    <li className="py-5 text-foreground first:pt-0 last:pb-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3"><UpgradeMemberAvatar name={offer.member_name} src={offer.avatar_url} className="h-11 w-11" /><div className="min-w-0"><Button variant="link" className="h-auto min-h-11 max-w-full justify-start whitespace-normal p-0 text-left text-base font-semibold text-foreground" onClick={() => navigate(`/members?member=${offer.member_id}`)}>
            {offer.member_name}<ArrowUpRight className="ml-2 h-4 w-4 shrink-0" />
          </Button>
          <p className="text-xs text-muted-foreground">{offer.member_code}</p></div></div>
        </div>
        <div className="text-right">
          <Badge className={cn('gap-1.5 border-0 px-3 py-1.5', urgent ? 'bg-warning/15 text-foreground' : 'bg-info/10 text-info')}><Clock className="h-3.5 w-3.5" />{left.milliseconds < 86_400_000 ? `${left.hours}h left` : `${left.days} days left`}</Badge>
          {showRevenue && <p className="mt-2 text-sm font-semibold tabular-nums">₹{Number(offer.upgrade_cost ?? 0).toLocaleString('en-IN')} <span className="text-xs font-normal text-muted-foreground">to Annual</span></p>}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5"><CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div className="min-w-0"><p className="text-[11px] text-muted-foreground">Current plan</p><p className="break-words text-sm font-semibold">{offer.plan_name ?? 'Membership'}</p></div></div>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Joined {date(offer.joined_at)}</span><span>Plan started {date(offer.start_date)}</span></div>
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs"><span className="font-medium">Day {day} of 15</span><span className="text-muted-foreground">Ends {timestamp(offer.window_ends_at)} IST</span></div>
        <progress className={cn('block h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full', urgent ? '[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning' : '[&::-webkit-progress-value]:bg-info [&::-moz-progress-bar]:bg-info')} value={upgradeElapsedPercent(offer.window_ends_at, now)} max={100} aria-label={`${offer.member_name}: elapsed annual upgrade window`} aria-valuetext={`Day ${day} of 15; ${left.hours} hours remaining`} />
        <ol className="mt-2 grid grid-cols-4 gap-1 text-xs text-muted-foreground" aria-label="Upgrade milestones">{[{ label: 'Start', day: 1 }, { label: 'Day 7', day: 7 }, { label: 'Day 12', day: 12 }, { label: 'Deadline', day: 16 }].map((step, index) => <li key={step.label} className={cn('flex items-center gap-1', index === 3 ? 'justify-end' : index > 0 ? 'justify-center' : '', day >= step.day && 'font-medium text-foreground')}>{day >= step.day && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}{step.label}</li>)}</ol>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</span>
        {offer.reminders.map((r) => <span key={r.stage} className="inline-flex flex-wrap items-center gap-1.5"><span className="text-muted-foreground">Day {r.stage === 'd7' ? '7' : '12'}</span><Badge variant="secondary" className={cn('border-0 text-xs capitalize', tones[r.status] ?? 'bg-muted text-muted-foreground')}>{r.status === 'scheduled' && day >= (r.stage === 'd7' ? 7 : 12) ? 'Not sent' : r.status}</Badge>{r.timestamp && <span className="text-muted-foreground">{timestamp(r.timestamp)} IST</span>}</span>)}
      </div>
      {offer.reminders.filter(r => r.reason && ['failed', 'suppressed', 'bounced'].includes(r.status)).map(r => {
        const explanation = explainCommError(r.reason);
        return <div key={r.stage} className="mt-2 rounded-lg bg-muted/50 p-3 text-xs"><p className="font-semibold">Day {r.stage === 'd7' ? '7' : '12'} · {isPacingError(r.reason) ? 'Not delivered · Meta pacing (131049)' : explanation.title}</p><p className="mt-1 text-muted-foreground">{explanation.what}</p><p className="mt-1 text-muted-foreground">{explanation.action}</p></div>;
      })}
    </li>
  );
}