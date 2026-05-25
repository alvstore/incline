/**
 * P4 — Capability registry.
 *
 * Single source of truth for "what can this role do?" on the client.
 * Mirrored on the server in `public.role_capabilities` + `has_capability(_user, _cap)`.
 *
 * Use these instead of inline `hasAnyRole(['owner','admin'])` checks so capability
 * drift is caught in one place.
 */

export type AppRole = 'owner' | 'admin' | 'manager' | 'staff' | 'trainer' | 'member';

export type Capability =
  | 'view_financials'
  | 'manage_staff'
  | 'record_payment'
  | 'approve_discount'
  | 'cross_branch_view'
  | 'manage_settings'
  | 'cancel_membership'
  | 'freeze_membership'
  | 'credit_member'
  | 'manage_devices'
  | 'manage_automations'
  | 'view_reconciliation'
  | 'book_facility';

const MATRIX: Record<Capability, AppRole[]> = {
  view_financials:     ['owner', 'admin', 'manager'],
  manage_staff:        ['owner', 'admin'],
  record_payment:      ['owner', 'admin', 'manager', 'staff'],
  approve_discount:    ['owner', 'admin', 'manager'],
  cross_branch_view:   ['owner', 'admin'],
  manage_settings:     ['owner', 'admin'],
  cancel_membership:   ['owner', 'admin', 'manager'],
  freeze_membership:   ['owner', 'admin', 'manager'],
  credit_member:       ['owner', 'admin', 'manager'],
  manage_devices:      ['owner', 'admin', 'manager'],
  manage_automations:  ['owner', 'admin'],
  view_reconciliation: ['owner', 'admin'],
  book_facility:       ['owner', 'admin', 'manager', 'staff', 'trainer', 'member'],
};

export function hasCapability(roles: AppRole[] | string[] | undefined, cap: Capability): boolean {
  if (!roles || roles.length === 0) return false;
  const allowed = MATRIX[cap];
  return roles.some((r) => allowed.includes(r as AppRole));
}

export const can = {
  viewFinancials:    (r?: string[]) => hasCapability(r, 'view_financials'),
  manageStaff:       (r?: string[]) => hasCapability(r, 'manage_staff'),
  recordPayment:     (r?: string[]) => hasCapability(r, 'record_payment'),
  approveDiscount:   (r?: string[]) => hasCapability(r, 'approve_discount'),
  crossBranchView:   (r?: string[]) => hasCapability(r, 'cross_branch_view'),
  manageSettings:    (r?: string[]) => hasCapability(r, 'manage_settings'),
  cancelMembership:  (r?: string[]) => hasCapability(r, 'cancel_membership'),
  freezeMembership:  (r?: string[]) => hasCapability(r, 'freeze_membership'),
  creditMember:      (r?: string[]) => hasCapability(r, 'credit_member'),
  manageDevices:     (r?: string[]) => hasCapability(r, 'manage_devices'),
  manageAutomations: (r?: string[]) => hasCapability(r, 'manage_automations'),
  viewReconciliation:(r?: string[]) => hasCapability(r, 'view_reconciliation'),
  bookFacility:      (r?: string[]) => hasCapability(r, 'book_facility'),
};

/**
 * Roster permissions.
 *  - Owner/Admin: full edit on any row (including own).
 *  - Manager: can edit staff/trainer rows, but NOT their own row.
 *  - Staff: view + export only.
 *  - Trainer/Member: no roster page access.
 *
 * Server-side guard: trigger `tg_block_manager_self_edit` mirrors this on the DB.
 */
export function canEditAnyRoster(roles?: string[]): boolean {
  if (!roles) return false;
  return roles.some((r) => r === 'owner' || r === 'admin' || r === 'manager');
}

export function canEditRosterRow(
  roles: string[] | undefined,
  targetUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  if (!roles || !targetUserId) return false;
  if (roles.some((r) => r === 'owner' || r === 'admin')) return true;
  if (roles.includes('manager')) return targetUserId !== currentUserId;
  return false;
}

export function canExportRoster(roles?: string[]): boolean {
  if (!roles) return false;
  return roles.some((r) => r === 'owner' || r === 'admin' || r === 'manager' || r === 'staff');
}

/**
 * Strict "punch up" rule for manual staff attendance (biometric-failure fallback).
 *
 * Nobody marks their own attendance — even owners must pass the turnstile.
 * The matrix here decides whether `actor` may record attendance for `target`.
 *
 * Matrix (actor → can record for):
 *   Owner   → Admin · Manager · Staff · Trainer  (NOT self, NOT other owners by default)
 *   Admin   → Manager · Staff · Trainer          (NOT self, NOT other admins, NOT owner)
 *   Manager → Staff · Trainer                    (NOT self, NOT other managers, NOT admin/owner)
 *   Staff/Trainer/Member → nobody
 */
export type AttendanceDecision = {
  allowed: boolean;
  reason?: string;
};

const RANK: Record<string, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  staff: 2,
  trainer: 2,
  member: 1,
};

function topRole(roles: string[] | undefined): string | null {
  if (!roles || roles.length === 0) return null;
  return roles.reduce<string | null>((best, r) => {
    if (!best) return r;
    return (RANK[r] ?? 0) > (RANK[best] ?? 0) ? r : best;
  }, null);
}

export function canRecordAttendanceFor(
  actorRoles: string[] | undefined,
  targetRoles: string[] | undefined,
  isSelf: boolean,
): AttendanceDecision {
  if (isSelf) {
    return { allowed: false, reason: 'Self-attendance is not allowed — a higher authority must record it.' };
  }
  const actor = topRole(actorRoles);
  const target = topRole(targetRoles) ?? 'staff'; // default unknown to staff-level
  if (!actor) return { allowed: false, reason: 'You do not have permission to record attendance.' };

  const actorRank = RANK[actor] ?? 0;
  const targetRank = RANK[target] ?? 0;

  // Only owner/admin/manager can record at all.
  if (actorRank < RANK.manager) {
    return { allowed: false, reason: 'Only managers, admins, or owners can record staff attendance.' };
  }
  // Manager cannot record other managers, admins or owners.
  if (actor === 'manager' && targetRank >= RANK.manager) {
    return { allowed: false, reason: 'Only an admin or owner can record this person.' };
  }
  // Admin cannot record other admins or owner.
  if (actor === 'admin' && targetRank >= RANK.admin) {
    return { allowed: false, reason: 'Only an owner can record this person.' };
  }
  // Owner cannot record another owner (effectively requires a second owner).
  if (actor === 'owner' && target === 'owner') {
    return { allowed: false, reason: 'Another owner must record this entry.' };
  }
  return { allowed: true };
}
