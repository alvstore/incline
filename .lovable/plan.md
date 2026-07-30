## Audit findings (all verified against code + database)

**1. Love Kumar Paliwal (INC-26-0004) — "login is required" on photo upload**
Confirmed in DB: this member row has `user_id = NULL` (no linked login, no profile). `MemberAvatarUpload` correctly refuses to upload because the `avatars` bucket policy requires the object path to start with the owner's user id. Root cause is upstream: the lead→member conversion did not provision a login. A `provision-member-login` function already exists but was never invoked for this record.

**2. PT packages dashboard inconsistency**
DB shows exactly one PT package ever sold, and it is `status = 'reversed'` (Priyanka Lohar, invoice `INV-INC-26-0054`, `status = 'cancelled'`). Yet:
- `/pt-sessions` correctly shows "No active packages".
- `/analytics` shows ₹18,000 PT revenue, 1 package sold, Top PT Performer — because the analytics query (`Analytics.tsx`, `member_pt_packages` select) has **no status filter**, so reversed/cancelled sales still count as revenue.
Also: session-based vs monthly packages are rendered with the same generic badge, and commissions are not shown/reversed visibly anywhere on the PT dashboard.

**3. `/fitness/templates` — "Load failed"**
6 occurrences in `error_logs`, `severity=error`, `stack_trace = NULL`. This is the browser's message for a failed dynamic `import()` of a lazy route chunk (stale chunk after a redeploy), not a bug inside `Templates.tsx` — the page itself has no failing query path.

**4. Warm follow-up nudges firing for brand-new members**
`get_inactive_members()` uses `LEFT JOIN LATERAL` on attendance and matches `ma.last_check_in IS NULL`. A member who has **never** checked in (i.e. just registered, gym only opened) qualifies immediately, and `days_absent` comes back NULL, which the alert renders as the literal string "21+". So freshly registered members are flagged as 21+ days absent.

**5. Waiver PDF download fails**
`register-member` uploads to bucket **`member-onboarding`** (`{member_id}/onboarding-waiver.pdf`), but `MemberProfileDrawer`/`MemberProfile` call `signMemberDocument(path)` which defaults to the **`documents`** bucket. Hence "Object not found". `member-onboarding` isn't even in the helper's allowed bucket union.

**6. Self-registration missing address + government ID**
`PublicRegistration.tsx` has `address` in the zod schema but renders **no input** for it, and has no government-ID fields at all. The `register-member` edge function already accepts and persists `address`, `government_id_type`, `government_id_number` — the form simply never sends them, so staff must re-enter address afterwards.

---

## Fix plan

### A. Member login provisioning (item 1)
- Backfill: provision a login for INC-26-0004 (and any other member rows with `user_id IS NULL`) via the existing `provision-member-login` function, linking `members.user_id` → new `profiles.id`.
- Add a self-healing path: when lead→member conversion completes without a login, enqueue provisioning automatically.
- In `MemberAvatarUpload`, replace the dead-end error with an inline **"Create login & continue"** action (owner/admin/manager only) that provisions the login and retries the upload in the same flow.

### B. PT dashboard redesign + correctness (item 2)
- **Data correctness:** filter `member_pt_packages` in `Analytics.tsx` to exclude `reversed`/`cancelled` statuses for revenue, packages-sold, top performer and revenue-by-trainer; source revenue from paid invoice amounts rather than package price.
- **Unified session/monthly model (UI layer):** one package card/row that switches presentation by `package_type`:
  - `session_based` → progress bar `used / total sessions` + remaining count.
  - `monthly` → days-remaining ring + expiry date, red warning ≤7 days.
- **Commission & payout column:** show commission base (pre-GST subtotal), commission %, accrued amount, and payout state per package/trainer, with reversed sales clearly struck-through and excluded from totals.
- **Trainer attendance:** surface a per-package "Mark session" action consistent with `MyClients.tsx` optimistic flow, blocked when sessions are exhausted or the monthly window has expired.
- Vuexy styling: `rounded-2xl`, soft slate shadows, colored status badges, skeleton/empty/error states on every panel.

### C. `/fitness/templates` chunk load (item 3)
- Add a global lazy-import retry helper (retry once, then hard-reload with a cache-busting flag) and use it for all `lazy()` routes.
- Classify `Load failed` / `Failed to fetch dynamically imported module` as transient in `src/lib/errorReporter.ts` so System Health stops treating it as a critical app crash.

### D. Absence nurture correctness (item 4)
- Change `get_inactive_members` so "never checked in" is measured from the membership start date (or member join date), not treated as infinite absence, and return a real integer `days_absent` instead of NULL.
- Add a grace window: skip members whose membership started fewer than N days ago (default 7) so newly registered members are never flagged.
- Update `send-reminders` alert text to use the computed value instead of the "21+" fallback string.

### E. Waiver download (item 5)
- Add `member-onboarding` to `SignableBucket` and pass it explicitly at both call sites (`MemberProfileDrawer`, `MemberProfile`), or store the bucket alongside the path so the right bucket is always used.
- Verify RLS/storage policies allow branch-scoped staff and the member themself to sign that object.

### F. Registration address + government ID (item 6)
- Add **Address** (textarea) and **Government ID type + number** fields to the details step of `PublicRegistration.tsx`, wire them into the zod schema and the `register-member` payload.
- Confirm `register-member` writes them into `profiles` so the staff-side member form shows them pre-filled and no re-entry is needed.

### Technical notes
- Database changes: one migration for `get_inactive_members` (grace window + integer days).
- No schema changes needed for PT — the fix is query filtering and presentation only.
- Backfill for INC-26-0004 is a one-off function invocation, not a migration.
