import { FreezeMembershipDrawer } from './FreezeMembershipDrawer';
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void;
  member: { id: string; member_code: string; profiles?: { full_name: string } };
  activeMembership: { id: string }; onSuccess: () => void;
}
/** Compatibility entry point; all freeze surfaces share one server-backed drawer. */
export function QuickFreezeDrawer({ member, activeMembership, ...props }: Props) {
  return <FreezeMembershipDrawer {...props} membership={activeMembership} memberName={member.profiles?.full_name || member.member_code} />;
}
