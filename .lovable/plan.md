# Gate validity dates: why 2099, why PT-only members are still locked, and a Device settings panel

## What I checked (live)
- Surendra Singh Chundawat (INC-26-0102), Ravi Jain (INC-26-0085) and Vishal Kandara (INC-26-0101) owe only for **PT bills** (part-paid). They have no membership dues.
- Surendra and Ravi still show gate access **off**. Their last gate update was **2 Oct, 21:01**, which is before the new rule was switched on.
- The new gate rule is on for every branch (`enforce`). The "future start date lock" (2099) is also on.

## 1. Why the validity dates change to 2099
- This is on purpose. When a member is locked, the system sets their start date to **2099-01-01** and their end date to **2099-12-31**. The gate still recognises the face, says "Permission Denied" and keeps the door shut.
- We use this method because the older methods broke the gate. Deleting the face, or setting the end date to 2000-01-01, made the gate re-learn faces and restart, and in some cases remove them.
- When the member is unlocked, the start date goes back to their joining date and the end date goes back to their real membership end date.
- **The 2099 date is correct for a locked member. It is wrong for these three members**, because PT dues should no longer lock them (see 2).

## 2. Why nothing changed after the new rule
- The gate dates only change when something happens to that member, such as a payment, a new bill or a membership change. Switching the rule on did not trigger a re-check for members who were already locked.
- Members locked earlier for PT, store or add-on dues therefore still have 2099 dates, even though the new rule would let them in.
- **Fix:**
  - **One-time catch-up.** Find every member whose gate is off and whose only dues are PT, store or add-on bills. Unlock them one at a time, keeping the existing safety gap between gate updates, so the gates don't restart. Afterwards, check each gate's queue and confirm the restored dates.
  - **Make it automatic.** Whenever the gate rule changes for a branch (old rule, trial or new rule), queue a careful re-check of every affected member in that branch.
  - **Correct gate unlocking.** The gate unlock decision will use the same RED/AMBER/GREEN result as the scan check. Only membership dues (RED) set the 2099 dates. AMBER and GREEN members get their real dates.
  - **Front desk alert.** AMBER members still raise the front-desk alert and stay blocked from digital bookings and purchases. Only the physical door opens.

## 3. Settings panel in Devices (new "Gate Rules" tab, owner/admin only)
Today these switches can only be changed in the database, so this tab adds controls for them:
- **Gate rule per branch:** Old rule / Trial (no effect at the gate) / New rule. Changing it asks for confirmation and starts the re-check from step 2.
- **Lock method:** Future start date (2099), recommended / Past end date (2000). Includes a short note on what each one does at the gate.
- **Which dues block the door:** Membership always blocks. PT, store and add-on dues are shown as "alert only" and cannot be changed, so the rule stays safe.
- **"Re-check all members now" button** with live progress (queued / done / failed), plus a list of members whose gate state doesn't match what their dues say should happen ("drift list"). Each row has a "Fix" button.
- **Recent changes log:** who changed which setting, and when.
- **Accessibility:** proper labels on every switch, keyboard and focus support, confirmation messages read aloud to screen readers, buttons large enough to tap, built from the existing drawers and cards in the app.

## Technical details
- Audit `mips-access` restore path: compute `lock_state` from `member_access_status().tier` (`red` → TZ revoke; `amber|green` → restore `validTimeBegin=joining`, `validTimeEnd=membership end`). Bump version.
- New guarded RPC `gate_access_drift(branch)` and `gate_recheck_branch(branch)` (owner/admin + `rpc_guard_applies`, `GRANT EXECUTE TO authenticated`) enqueueing into `biometric_sync_queue`; worker is the existing sequential sync queue respecting `mips_dispatch_state` gap/cooldown and delta `state_sig`.
- Trigger on `settings` for `gate_tier_mode` changes → enqueue re-check.
- Settings writes via guarded RPC `set_gate_settings(branch, mode, revoke_mode)` with `audit_logs` entry.
- UI: `src/components/devices/GateRulesTab.tsx` with TanStack Query, owner/admin gated via `can.*`.
- Verification: run catch-up, confirm Surendra/Ravi on MIPS show joining → membership end dates and `hardware_access_enabled=true`; confirm one RED member still shows 2099.
- Update `mem://integrations/mips-targeted-dispatch` with "tier change ⇒ re-check" rule.
