
## System Health audit

### Cluster 1 — `process_scheduled_campaigns` cold-start 502 (warning)
- **Root cause:** Edge gateway cold-boot returning 502; `automation-brain` v2.1.0 already retries with backoff and downgrades the final failure from `error` → `warning` (`gateway_cold_start:true`). The scheduled campaign still runs on the next warm tick.
- **Verdict:** Informational, not a code defect. No fix required. Optional hardening: schedule a lightweight warm-up ping (`/functions/v1/process-scheduled-campaigns` HEAD) 30s before the campaign tick so the isolate is already hot.

### Cluster 2 — `record "new" has no field "branch_id"` on `/rest/v1/member_comps`
- **Root cause (confirmed via `pg_trigger` + `information_schema`):**
  `audit_member_comps_trigger` executes `audit_log_trigger_function()`, which unconditionally reads `NEW.branch_id`. `public.member_comps` has no `branch_id` column, so **every INSERT/UPDATE on member_comps throws** — meaning the "Comp Sessions" tab in `CompGiftDrawer.tsx` fails silently for admin/manager (direct execution path) and the audit_logs row is never written.
- **Shared cause?** No — unrelated to Cluster 1.

---

## Comp / Gift audit — findings

Current `member_comps` row stores only: `member_id, membership_id, benefit_type_id, comp_sessions, used_sessions, reason, granted_by, created_at`.

Gaps for a real audit trail:
1. No `branch_id` → breaks branch scoping, breaks the generic audit trigger, breaks manager-only visibility.
2. No `source` (`direct` vs `approval`) or `approval_request_id` → can't tell "who approved this comp".
3. No `expires_at` → open-ended comps live forever.
4. No `notes` distinct from `reason` (reason = why given, notes = internal remarks).
5. `CompGiftDrawer` performs **two client writes** (member_comps insert + audit_logs insert) — not atomic; if audit insert fails the comp is silent.
6. Comp/Gift history is not surfaced on the member profile — only visible inside the drawer.

---

## Fix plan

### 1. Database migration (one file)

**a. Extend `member_comps` schema**
- Add `branch_id uuid REFERENCES branches(id)` (nullable during backfill, then NOT NULL)
- Add `source text NOT NULL DEFAULT 'direct'` check in (`'direct','approval'`)
- Add `approval_request_id uuid REFERENCES approval_requests(id)`
- Add `expires_at timestamptz`
- Add `notes text`
- Add `updated_at timestamptz` + trigger
- Backfill `branch_id` from `members.branch_id` for existing rows.
- Index `(member_id, branch_id)` and `(branch_id, created_at desc)`.

**b. Fix generic audit trigger for tables without `branch_id`**

Update `public.audit_log_trigger_function()` to resolve branch defensively:
```sql
-- replace: v_branch := NEW.branch_id;
-- with:
BEGIN
  v_branch := (to_jsonb(NEW) ->> 'branch_id')::uuid;
EXCEPTION WHEN OTHERS THEN v_branch := NULL;
END;
```
Same pattern for UPDATE / DELETE branches. This makes the trigger safe for any future table lacking `branch_id`.

**c. Atomic RPC `grant_member_comp(p_member_id, p_branch_id, p_benefit_type_id, p_sessions, p_reason, p_notes, p_expires_at, p_source, p_approval_request_id)`**
- SECURITY DEFINER, validates caller role/branch, resolves `granted_by := auth.uid()`
- Inserts into `member_comps` and writes an `audit_logs` row inside the same txn
- Returns the new comp row
- Called from both `CompGiftDrawer` (direct path) and the approval-execution code in `approvalService`.

**d. Extend `approval_requests` execution for `comp_gift`** so approved requests call the same RPC (single source of truth) instead of the current ad-hoc insert.

### 2. Frontend — `src/components/members/CompGiftDrawer.tsx`

- Replace the two-step `insert(member_comps) + insert(audit_logs)` in `compMutation` with a single `supabase.rpc('grant_member_comp', {...})`.
- Add fields: **Expires on** (date picker, optional), **Internal notes** (textarea).
- Show a compact **Comp history table** under the existing "ACTIVE COMPS" section:
  columns → Date · Benefit · Sessions (used/total) · Granted by · Source badge (Direct/Approval) · Reason · Expires.
- Both `extendMutation` and `compMutation` staff-path payloads should include `notes` and `expires_at` so the approval queue captures them; on execution, approval passes them into the RPC.

### 3. Member profile — `src/components/members/MemberProfileDrawer.tsx`

- Add a **"Comps & Gifts"** subsection (Vuexy card, rounded-2xl, soft shadow) listing all comps for that member with the same columns as above. Read-only. This gives managers a single audit view per member.

### 4. Verification

- Run migration → re-run the failing INSERT manually via `supabase--read_query` (SELECT after INSERT) to confirm no trigger error.
- Grant a comp as staff (approval path) and as manager (direct path); confirm one `audit_logs` row per action with correct actor, branch, and reason.
- Confirm existing rows still render (backfill filled `branch_id`).
- Confirm SystemHealth stops receiving fingerprint `13a6ba3c…` after next member action.

---

## Files to touch

- **new migration** — `member_comps` columns, audit trigger fix, `grant_member_comp` RPC, backfill, indexes.
- `src/components/members/CompGiftDrawer.tsx` — RPC call, expires/notes fields, history table.
- `src/components/members/MemberProfileDrawer.tsx` — Comps & Gifts card.
- `src/services/approvalService.ts` (or the approval execution edge fn) — route `comp_gift` approvals through `grant_member_comp`.

No changes to Cluster 1 (accepted as warning).
