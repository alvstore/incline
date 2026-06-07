## System Audit — Read-Only Findings (no changes made)

Scope: security scanner + Supabase linter (459 issues) + RLS policies + error_logs + communication_logs (7d) + edge function logs + code metrics. Nothing modified.

---

### 1. Security & RLS (highest priority)

**P0 — Critical (block before next release)**
- None open. The 10 scanner findings raised earlier this turn were fixed in the previous migration. Re-scan is clean.

**P1 — High (Supabase linter, 459 total — grouped)**
1. **SECURITY DEFINER functions executable by `anon` / `authenticated` (~420 of the 459 warnings).** Most of these are legitimate (`has_role`, `has_any_role`, `record_payment`, `purchase_membership`, etc.) but a meaningful subset are internal helpers (`dr_*`, embedding triggers, audit helpers, system-only RPCs) that should `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE TO service_role` only. Needs a one-time triage pass: list every SECURITY DEFINER fn, classify [public API / authenticated API / system-only], then revoke unused grants.
2. **Function search_path mutable (2 fns).** Two functions still missing `SET search_path = public`. Search-path hijack risk inside a SECURITY DEFINER context.
3. **Extensions in `public` schema (3): `pg_trgm`, `pg_net`, `vector`.** Recommended to move to `extensions` schema; non-trivial migration risk because `vector` is used in `ai_knowledge.embedding`. Treat as **accepted warning** unless a security review demands the move.
4. **Public bucket allows listing (6 buckets).** `org-assets`, `member-photos`, `attachments`(?), `workout-videos`, etc. — broad SELECT on `storage.objects` lets clients `list()` everything. Restrict SELECT to either path-scoped prefixes or staff role.
5. **RLS-enabled tables with no policies (4 tables).** RLS on but zero policy = table is locked for everyone except service_role. Usually intentional, but enumerate and confirm each is meant to be admin-only.
6. **RLS policy always-true on UPDATE/INSERT/DELETE (3 hits).** A blanket `WITH CHECK (true)` on a write path is a privilege escalation vector. Identify the 3 tables and tighten.

**P2 — Operational**
7. **GOTRUE_JWT_DEFAULT_GROUP_NAME / GOTRUE_JWT_ADMIN_GROUP_NAME deprecated** (auth logs). No action by us — Supabase will remove. Track upstream.
8. **Pwned-passwords HIBP cache loading every reboot.** Confirms HIBP is on — good. No fix needed.

---

### 2. RPC / Database integrity

- **No open errors in `error_logs` in the last 7 days.** Recent log table shows only 6 historical `resolved` rows. Healthy.
- **`dr_block_writes` trigger present** on critical tables (per memory) — confirmed safe for restores.
- **`record_payment`, `purchase_membership`, `cancel_membership`, `freeze_membership`, `transition_member_lifecycle`** all present and SECURITY DEFINER — matches Core memory.
- **Avatar storage path convention drift.** `MemberAvatarUpload.tsx` writes to bucket `avatars` (`avatars/{userId}-…`), `EditProfileDrawer.tsx` writes to bucket `member-photos` (`avatars/{userId}-…`). Two different buckets for the same logical asset. Not a bug today (both buckets exist), but confusing and means avatar reads must check both. Worth consolidating in a future cleanup.

---

### 3. Communications (last 7 days)

```text
email     sent       22
email     failed      2
whatsapp  sent        8
whatsapp  failed      9   ← failure rate ≈ 53%
whatsapp  suppressed  1
```

Drilling into the 9 WhatsApp failures:
- **8 × Meta error `(#100) Invalid parameter`** on numbers `917356696393`, `919191910000`, `916384224228`. These look like test/placeholder numbers — confirm before action.
- **1 × `132001 Template does not exist in this WABA`** for `919928910901`. Means a template referenced in the dispatcher is not in Meta's library or was deleted. Needs a Templates Hub re-sync.
- **Earlier "auto-repaired: stuck in sending due to `delivery_metadata` NOT NULL bug — dispatch-communication v1.17.0"** rows confirm the v1.17.0 fix is reaping correctly. No action.

---

### 4. Edge function health

Sampled logs (last few cycles):
| Function | State |
|---|---|
| `automation-brain` | booting/shutting cleanly every 5 min — OK |
| `process-ig-comment-runs` | running every 1 min — OK |
| `reconcile-whatsapp-pending` | `{reaped:0,sent:0,failed:0}` — idle, OK |
| `send-reminders v2` | latest tick: `sent=0 failed=0`, all cleanup blocks `success:true` — OK |
| `process-comm-retry-queue` | booting on schedule — OK (no work to do) |
| `process-whatsapp-retry-queue` | booting on schedule — OK |
| `process-scheduled-campaigns` | booting on schedule — OK (since this turn's auth fix) |
| `lead-nurture-followup` | skipping IG leads because `AI channel 'instagram' is disabled` — **intentional per `ai_purposes.ops_config.channels` toggle**, not an error. Worth surfacing in admin UI so it isn't mistaken for a bug. |
| `google-reviews-brain` | boots, shuts down — no errors |

No 4xx/5xx HTTP responses in the analytics edge logs sample window.

---

### 5. Code quality (read-only metrics)

- **`: any` / `as any` occurrences:** ~1807 across `src/` (excluding `types.ts`). High — long-tail technical debt. Recommend a per-area cleanup budget rather than a big-bang refactor.
- **`console.log/warn/error` calls in src:** 88. Acceptable but should be replaced with `captureClientError` / `log_error_event` for any error path that should be observable in System Health.
- **TODO/FIXME/HACK:** Effectively none in `src/` or `supabase/functions/` (matches only doc comments). Good.
- **Large files / god components:** not measured this turn — recommend running `code_quality_checker.py` against `src/components` and `src/pages` in a follow-up for hard numbers.

---

### 6. UX / workflow observations (from earlier user-supplied chat trace)

- WhatsApp lead flow Name → Email → Goal → Plan — working per Founder's Phase memory.
- The "message marked Sent but is actually Delivered/Read" gap was closed earlier this turn via `record_delivery_event` + email/SMS/RCS webhooks + DeliveryTimeline channel awareness.
- Communication Hub still lacks a per-message "why did this fail" inline hint for Meta error codes (100, 132001, 131047, etc.). Currently surfaced only in `error_message` JSON blob. Could map to friendly labels in `LiveFeed`.

---

### 7. Prioritized backlog (recommended order, no work performed)

| # | Priority | Item |
|---|---|---|
| 1 | P1 | Triage SECURITY DEFINER grants; revoke `anon`/`authenticated` EXECUTE on system-only RPCs |
| 2 | P1 | Find & tighten the 3 always-true UPDATE/INSERT/DELETE RLS policies |
| 3 | P1 | Scope SELECT on 6 public buckets to staff/owner prefixes (or accept and document) |
| 4 | P1 | Pin `search_path` on the 2 remaining mutable functions |
| 5 | P2 | Confirm/clean the 4 "RLS enabled, no policy" tables |
| 6 | P2 | Re-sync deleted WhatsApp template causing 132001 for `919928910901` |
| 7 | P2 | Friendly error-code mapping in `LiveFeed` for Meta WhatsApp failures |
| 8 | P3 | Consolidate avatar bucket usage (`avatars` vs `member-photos/avatars/`) |
| 9 | P3 | Move `pg_trgm` / `pg_net` / `vector` extensions out of `public` (risk: vector column refs) |
| 10 | P3 | Replace stray `console.*` with `captureClientError` on error paths |
| 11 | P4 | Per-area `any`-type cleanup budget |

---

### Notes
- Nothing in this audit was changed. Each item above is a candidate; pick which to schedule.
- The current preview is stable: no console errors, no failed network requests, all cron functions returning clean ticks.