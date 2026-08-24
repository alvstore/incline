---
name: incline-dev-audit
description: "Use when auditing this codebase for correctness, security or convention drift — 'audit X', 'deep audit', 'review before release', 'is this safe', triaging security-scan findings, checking RLS/GRANT coverage, branch scoping, dispatcher compliance, atomic-RPC usage, or edge-function standards. Produces a severity-ranked findings report with file:line references and a fix order."
metadata:
  version: "1.0.0"
---

# Incline Dev Audit

A repeatable audit pass over the Incline gym platform. Work through the gates in order; each gate is a grep/query you actually run, not a judgement call. Record every failure as a finding, then produce one ranked report.

## Gate 0 — Signal first

- Read `/tmp/observability/build-errors.log`, `runtime-errors.log`, `console-logs.log`, `network-requests.log`.
- Query recent `error_logs` (grouped by `fingerprint`, last 7 days, `severity != 'info'` — `info` rows with `source='whatsapp_brain'` are heartbeats).
- Run the linter/advisor and the security scan; load existing findings before writing new ones so you don't duplicate.

A build error or an unresolved runtime error is automatically a **blocker**.

## Gate 1 — RLS and GRANT coverage

For every table in `public`:

```sql
select c.relname,
       c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 2, 1;
```

Findings:
- RLS off on a public table → **blocker**.
- RLS on with zero policies → table is unreachable → **major**.
- `anon` SELECT true with no anon-scoped policy intent → **blocker** if the table holds PII.
- Missing `service_role` grant on a table touched by an edge function → **major**.

## Gate 2 — Branch scoping and PII

- Any policy on branch-owned data that does not reference `user_visible_branch_ids()` / branch scoping → **major**.
- Rows with `branch_id IS NULL` reachable by managers/staff on PII tables (`leads`, `contacts`, `profiles`, `whatsapp_*`) → **blocker**.
- Client queries: `rg "from\('(members|leads|invoices|payments|contacts)'\)" src/` — each must filter `branch_id` unless the caller is an owner viewing all branches.
- Sensitive member documents: `rg "getPublicUrl" src/` — any hit on member ID/medical/contract paths is a **blocker**; must use `signMemberDocument`.

## Gate 3 — Atomic write compliance

Business writes must go through RPCs. Flag any client-side multi-step write to:

| Domain | Required RPC |
| --- | --- |
| Payments | `record_payment`, `reverse_payment` |
| Membership | `purchase_membership`, `cancel_membership`, `freeze_membership` |
| Lifecycle | `transition_member_lifecycle` |
| Bookings | `book_facility_slot` |
| Coupons | `validate_coupon`, `redeem_coupon` |
| Lockers / staff attendance / approvals / PT purchase / commission reversal | their dedicated RPCs |

`rg "\.insert\(|\.update\(" src/services/` and check each against this table.

Also: `rg "''" ` on insert payloads for auto-generated code columns — pass `null`, never `''`, or the generator trigger never fires.

## Gate 4 — Communications compliance

- `rg "communication_logs" src/` → any direct insert is a **blocker** (CI guard also blocks it).
- `rg "functions.invoke\('send-" src/` → client must never call `send-*` directly; route through `dispatchCommunication()`.
- WhatsApp document events must use `header_type='none'` + `{{document_link}}`.
- Every nurture/broadcast path must honour `do_not_contact`.

## Gate 5 — Edge function standards

For each `supabase/functions/*/index.ts`:
- top-of-file `// vX.Y.Z` version comment;
- strict CORS headers incl. an `OPTIONS` short-circuit;
- top-level try/catch returning JSON with a non-200 on failure;
- errors reported via `log_error_event`;
- no secrets logged, no service-role key echoed;
- webhooks fail **closed** on missing/invalid signature.

## Gate 6 — Database function hygiene

```sql
select p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and (p.proconfig is null
  or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
```

Any `SECURITY DEFINER` function without a pinned `search_path` → **blocker**.

## Gate 7 — Frontend conventions

- Data fetching uses TanStack Query with `isLoading` / `isError` / `data` handled, and `invalidateQueries` after every mutation.
- No `any` types in changed files.
- Create/edit forms are right-side `Sheet` drawers, not dialogs.
- RBAC checked before rendering financial or admin UI (`can.X(roles)`, never inline role arrays).
- Loading skeletons, empty states and error states present on every data surface.

## Gate 8 — Verify the fix

Never close a finding on reasoning alone: re-run the query, re-read the log, or drive the flow in the browser (see `incline-e2e-playwright`). Then confirm `/tmp/observability/build-errors.log` says `build OK`.

## Report format

```
## Blockers
1. <one-line title>
   Where:    supabase/functions/foo/index.ts:88
   Evidence: <query output / log line / grep hit>
   Impact:   <what a real user or attacker gets>
   Fix:      <concrete change>

## Major
## Minor
## Verified clean
<gates that passed, so the next audit can skip re-proving them>
```

Fix order: blockers by blast radius (data exposure > data loss > money > UX), then majors that share a root cause with a blocker, then the rest.
