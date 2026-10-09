import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock3, Gift, XCircle } from 'lucide-react';
import { rewardDisplayStatus, type RewardFilterRow } from './referralWorkspaceUtils';

export function ReferralStatusBadge({ status }: { status: string }) {
  if (status === 'converted') return <Badge className="border border-success/20 bg-success/10 text-success">Converted</Badge>;
  if (status === 'expired') return <Badge className="border border-destructive/20 bg-destructive/10 text-destructive">Expired</Badge>;
  return <Badge className="border border-warning/20 bg-warning/10 text-warning capitalize"><Clock3 className="mr-1 h-3 w-3" />{status}</Badge>;
}

export function RewardStatusBadge({ reward }: { reward: RewardFilterRow }) {
  const status = rewardDisplayStatus(reward);
  if (status === 'credited') return <Badge className="border border-success/20 bg-success/10 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />Credited</Badge>;
  if (status === 'pending_approval') return <Badge className="border border-warning/20 bg-warning/10 text-warning"><Clock3 className="mr-1 h-3 w-3" />Awaiting approval</Badge>;
  if (status === 'rejected') return <Badge className="border border-destructive/20 bg-destructive/10 text-destructive"><XCircle className="mr-1 h-3 w-3" />Rejected</Badge>;
  return <Badge variant="outline" className="text-primary"><Gift className="mr-1 h-3 w-3" />Ready to claim</Badge>;
}
