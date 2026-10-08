# Agreement lockdown, automatic login revoke, PT trainer handover

## 1. Members cannot download their agreement
- Remove the View and Download buttons from the member's own Profile page. Keep a read-only "Agreement signed on <date> · Ref AGR-…" line, plus a note: "Kept by The Incline for records. Ask the front desk for a copy."
- On the server, the agreement service refuses `get` for member callers, so the link can't be opened by calling it directly either. Staff and owners keep view, print and download from the drawer.
- Storage read rules on the onboarding files are narrowed to staff only. Members lose read access to their own agreement and waiver PDFs, while keeping access to their own signature image if a screen still uses it.

## 2. Login access for expired or inactive members
**Member drawer, new "App access" card (staff and above)**
- Status pill: Active / Disabled (manual) / Auto-revoked (membership expired) / No login.
- A "Disable login" or "Enable login" switch, with a required reason when disabling, and a "last changed by / when" line.
- Disabling asks for confirmation in a small dialog. Enabling an auto-revoked member warns them that the login will be revoked again on the next check unless the membership gets renewed.

**Automatic rules**
- Login is revoked when a member has no active or frozen membership and the latest one ended more than the 7-day grace period ago, or when the member status is inactive, suspended or blacklisted.
- Login is restored automatically when a membership becomes active again through a purchase, renewal or unfreeze. A manual disable is never auto-restored.
- A settings switch, "Auto-revoke app login on expiry" (owner only, default ON), works as a kill switch.
- Signed-in sessions are signed out, and a revoked member who tries to log in sees: "Your membership has ended — contact the front desk to renew."
- Members are not sent any message.

## 3. PT package trainer handover
Current live data: Ritesh Sharma is inactive but still owns 4 active client packages. He has 4 commission parts still pending (2 in October, ₹6,152; 2 in November, ₹6,152) and 6 already paid. Lokendra has no active packages.

**Workflow**: "Transfer PT clients" drawer (owner/admin/manager)
- Entry points: a button on an offboarded or inactive trainer's row in HRM, and a "Change trainer" action on any single PT package in the member drawer.
- Step 1 lists the outgoing trainer's active packages: member, sessions left, expiry, and unpaid commission.
- Step 2 picks the new trainer per package, or one trainer for all, plus an effective date (default today, never before the last completed session).
- Step 3 previews each package: the old trainer keeps commission for parts paid or falling before the date, the new trainer gets the parts on or after it, and future scheduled sessions move to the new trainer.
- Confirm runs one server transaction for everything.

**Rules that keep payroll correct**
- Paid commission is never touched. Parts that are pending but already settled in a payroll run stay with the old trainer.
- Pending parts with a payout month on or after the effective month are reassigned to the new trainer. Amounts stay the same, so the trainer total is unchanged.
- Completed sessions keep their original trainer for attendance history. Scheduled future sessions move.
- The package `trainer_id` changes, and the member's assigned trainer switches too unless "keep general trainer" is ticked.
- Every move is written to a new transfer history: package, from, to, effective date, the parts moved, who did it, and the reason. It shows on the package timeline and in the payroll audit.
- The change can be undone within the same month, as long as no moved part has been settled yet.

## Technical details
- `src/pages/MemberProfile.tsx`: drop the agreement buttons and their handlers. `membership-agreement` edge fn: `get` requires staff role. A storage policy migration on `member-onboarding` handles the PDFs.
- New columns on `members`: `login_disabled_at`, `login_disabled_reason`, `login_disabled_by`, `login_disabled_source` ('manual' or 'auto'). A new edge fn `member-login-access` (service role) sets the auth user's `ban_duration` ('876000h' or 'none') and signs them out. It is called by the drawer toggle, with a staff and branch check.
- Automation: the rule `revoke_expired_member_logins` runs in Automation Brain hourly, gated by an EXISTS check on pending work per the cron pattern. A trigger on `memberships` for the active-status transition queues a restore. The kill switch lives in `settings` (`member_login_autorevoke`).
- New table `pt_trainer_transfers` (with GRANTs, RLS and branch-scoped policies). A SECURITY DEFINER RPC `transfer_pt_package_trainer(_package_ids, _to_trainer, _effective_date, _keep_general, _reason)` uses `rpc_guard_applies` + `assert_branch_staff` + a manager check, pins search_path, and gets an explicit GRANT to authenticated. It updates `member_pt_packages.trainer_id`, unsettled `pt_commission_installments` (where `payroll_item_id IS NULL` and `payout_month >= date_trunc('month', effective)`), future `pt_sessions`, and `members.assigned_trainer_id`. The same pattern gives an undo RPC.
- UI: `TransferPTClientsDrawer.tsx` (Sheet, sticky footer, 44px targets, labelled selects, skeletons). The entry points go in `StaffRowActions` / `OffboardStaffSheet` and the member PT section.
- Tests: commission split by effective date, paid parts unchanged, and the auto-revoke grace-day rule.

## Verification
- Signed in as Mohit: the profile shows no agreement buttons, and a direct call is denied.
- Disable and enable a test member: login is blocked or allowed, and the expiry job revokes and then restores after renewal.
- Dry-run Ritesh's 4 packages to a new trainer: the October and November pending parts move to the new trainer, the paid parts stay, and the payroll totals match.
