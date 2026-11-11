import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { BrowserNotifications } from '@/components/member/BrowserNotifications';

const TEAM_ROLES = ['owner', 'admin', 'manager'];

/** Phone & browser alerts for owners/admins/managers (late check-ins, approvals, tasks). */
export function TeamPushCard({ variant = 'settings' }: { variant?: 'prompt' | 'settings' }) {
  const { hasAnyRole } = useAuth();
  const { effectiveBranchId, branches } = useBranchContext();
  const isTeam = hasAnyRole(TEAM_ROLES as any);
  const branchId = effectiveBranchId || branches?.[0]?.id;
  if (!isTeam || !branchId) return null;
  return <BrowserNotifications branchId={branchId} variant={variant} />;
}
