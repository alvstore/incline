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
  | 'cancel_invoice'
  | 'freeze_membership'
  | 'credit_member'
  | 'manage_devices'
  | 'manage_automations'
  | 'view_reconciliation'
  | 'book_facility'
  | 'delete_task'
  | 'rcs_admin'
  | 'rcs_wallet_view';

const MATRIX: Record<Capability, AppRole[]> = {
  view_financials:     ['owner', 'admin', 'manager'],
  manage_staff:        ['owner', 'admin'],
  record_payment:      ['owner', 'admin', 'manager', 'staff'],
  approve_discount:    ['owner', 'admin', 'manager'],
  cross_branch_view:   ['owner', 'admin'],
  manage_settings:     ['owner', 'admin'],
  cancel_membership:   ['owner', 'admin', 'manager'],
  cancel_invoice:      ['owner', 'admin', 'manager'],
  freeze_membership:   ['owner', 'admin', 'manager'],
  credit_member:       ['owner', 'admin', 'manager'],
  manage_devices:      ['owner', 'admin', 'manager'],
  manage_automations:  ['owner', 'admin'],
  view_reconciliation: ['owner', 'admin'],
  book_facility:       ['owner', 'admin', 'manager', 'staff', 'trainer', 'member'],
  delete_task:         ['owner', 'admin', 'manager'],
  rcs_admin:           ['owner', 'admin'],
  rcs_wallet_view:     ['owner', 'admin'],
};

/** Accepts `['owner']` OR `[{ role: 'owner' }]` (AuthContext shape) — normalizing
 *  here keeps every `can.*` call site working regardless of which shape it holds. */
export type RoleLike = string | { role?: string | null } | null | undefined;

export function roleNames(roles?: RoleLike[] | null): string[] {
  if (!roles) return [];
  return roles
    .map((r) => (typeof r === 'string' ? r : r?.role ?? ''))
    .filter((r): r is string => Boolean(r));
}

export function hasCapability(roles: RoleLike[] | undefined, cap: Capability): boolean {
  const names = roleNames(roles);
  if (names.length === 0) return false;
  const allowed = MATRIX[cap];
  return names.some((r) => allowed.includes(r as AppRole));
}

export const can = {
  viewFinancials:    (r?: RoleLike[]) => hasCapability(r, 'view_financials'),
  manageStaff:       (r?: RoleLike[]) => hasCapability(r, 'manage_staff'),
  recordPayment:     (r?: RoleLike[]) => hasCapability(r, 'record_payment'),
  approveDiscount:   (r?: RoleLike[]) => hasCapability(r, 'approve_discount'),
  crossBranchView:   (r?: RoleLike[]) => hasCapability(r, 'cross_branch_view'),
  manageSettings:    (r?: RoleLike[]) => hasCapability(r, 'manage_settings'),
  cancelMembership:  (r?: RoleLike[]) => hasCapability(r, 'cancel_membership'),
  cancelInvoice:     (r?: RoleLike[]) => hasCapability(r, 'cancel_invoice'),
  freezeMembership:  (r?: RoleLike[]) => hasCapability(r, 'freeze_membership'),
  creditMember:      (r?: RoleLike[]) => hasCapability(r, 'credit_member'),
  manageDevices:     (r?: RoleLike[]) => hasCapability(r, 'manage_devices'),
  manageAutomations: (r?: RoleLike[]) => hasCapability(r, 'manage_automations'),
  viewReconciliation:(r?: RoleLike[]) => hasCapability(r, 'view_reconciliation'),
  bookFacility:      (r?: RoleLike[]) => hasCapability(r, 'book_facility'),
  deleteTask:        (r?: RoleLike[]) => hasCapability(r, 'delete_task'),
  rcsAdmin:          (r?: RoleLike[]) => hasCapability(r, 'rcs_admin'),
  rcsWalletView:     (r?: RoleLike[]) => hasCapability(r, 'rcs_wallet_view'),
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
export function canEditAnyRoster(roles?: RoleLike[]): boolean {
  return roleNames(roles).some((r) => r === 'owner' || r === 'admin' || r === 'manager');
}

export function canEditRosterRow(
  roles: RoleLike[] | undefined,
  targetUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  const names = roleNames(roles);
  if (names.length === 0 || !targetUserId) return false;
  if (names.some((r) => r === 'owner' || r === 'admin')) return true;
  if (names.includes('manager')) return targetUserId !== currentUserId;
  return false;
}

/**
 * Manager cannot manage their OWN HR / payroll / trainer / contract row.
 * Owners and admins can edit anyone (including themselves).
 * Mirrored on the server by trigger `tg_block_manager_self_hr` on
 * employees, contracts, trainers, payroll_items, payroll_run_lines.
 */
export function canManageHrRow(
  roles: RoleLike[] | undefined,
  targetUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  const names = roleNames(roles);
  if (names.length === 0 || !targetUserId) return false;
  if (names.some((r) => r === 'owner' || r === 'admin')) return true;
  if (names.includes('manager')) return targetUserId !== currentUserId;
  return false;
}

export function canExportRoster(roles?: RoleLike[]): boolean {
  return roleNames(roles).some((r) => r === 'owner' || r === 'admin' || r === 'manager' || r === 'staff');
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

function topRole(rolesInput: RoleLike[] | undefined): string | null {
  const roles = roleNames(rolesInput);
  if (roles.length === 0) return null;
  return roles.reduce<string | null>((best, r) => {
    if (!best) return r;
    return (RANK[r] ?? 0) > (RANK[best] ?? 0) ? r : best;
  }, null);
}

export function canRecordAttendanceFor(
  actorRoles: RoleLike[] | undefined,
  targetRoles: RoleLike[] | undefined,
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
