
# Error Cluster Audit & Fix Plan

Grouped by **root cause** (not cluster ID) so we ship the smallest, highest-leverage set of changes. Severity legend: P0 ship now · P1 next · P2 hygiene · INFO no-op.

---

## Group A — Edge worker 502s on cold start (P0)

**Clusters:** 1 (monitor_ai_lead_loss), 20 (benefit_t2h_reminders → send-reminders), 21 (lead_nurture_followup), 22 (process_whatsapp_retry_queue) — **20 occurrences**

**Root cause.** `automation-brain/index.ts` invokes worker functions with `apikey: SERVICE_KEY` only and a single in-flight 300ms retry. Recent logs show the workers themselves return 200 OK once booted (e.g. `[monitor-ai-lead-loss] {"ok":true,...}`). The 502s come from the **gateway** while the worker container is cold-booting past the gateway's short upstream-read deadline. The current retry fires immediately and hits the same cold container.

**Fix** (one file): `supabase/functions/automation-brain/index.ts` → in `callEdge`:
1. Treat HTTP **502/503/504** as retryable (not just `>=500`).
2. Do **two** retries with backoff `800ms`, `2000ms` (not one at 300ms) — gives the container time to finish booting.
3. On final 5xx, downgrade the row to `last_status='warning'` + log severity `warning` (not `error`) so a single cold-boot doesn't show up as a hard failure. We already have `last_dispatched_count` to detect actual data loss.
4. Add a 60s timeout `AbortController` per attempt so a hung gateway socket doesn't burn the whole tick.

No worker-side change needed — they already succeed once warm.

---

## Group B — `send-whatsapp` template `internal_lead_alert` not in Meta (P0)

**Clusters:** 13 (2 occ), 15 (**56 occ**) — biggest volume in the report.

**Root cause.** Caller is passing the literal template name `internal_lead_alert` to `send-whatsapp`, but that template was never approved (or was deleted) in this WA Business account. `notify-lead-created` v3.1 already guards against this by resolving via `v_template_with_meta_status` and skipping when no APPROVED row exists. The 56 hits are from **other call sites** still hard-coding the template name, plus dispatcher retries that don't honor a terminal-error code.

**Fix** (two surgical edits):
1. `supabase/functions/_shared/dispatch-communication` (or wherever WA send is invoked) — make Meta code **132001** (and **132000**, **132005**, **132012**, **132015**) **terminal**: mark queue row `abandoned`, do **not** re-enqueue, do **not** log as `error` (use `warning` with dedupe). This already exists for some codes per the WA 24h memory; extend the list.
2. `rg "template_name.*internal_lead_alert"` across the project and route every caller through `notify-lead-created`-style resolution (`v_template_with_meta_status` → APPROVED + not stale; skip if none). Confirmed in this audit that `notify-lead-created` is the only resolver; legacy direct calls remain in older internal-alert paths — grep + replace.
3. Frontend / `WhatsAppAutomations` UI: when a trigger references a template whose `whatsapp_meta_status != 'APPROVED'`, render an inline warning chip so admins notice before the next send. (Strictly UI/UX, satisfies the "respect knowledge base from frontend" directive.)

---

## Group C — `dr-replicate` 150s wall-clock timeout (P1)

**Cluster:** 9 (1 occ).

**Root cause.** Full schema+rows+storage replication is synchronous in a single Deno.serve handler; on large branches it busts the 150s edge limit.

**Fix.** `supabase/functions/dr-replicate/index.ts`:
- Split into **resumable chunks** keyed by `(table, last_pk_cursor)` persisted in a `dr_replication_state` row (already exists per DR v2 memory).
- Wrap heavy work in `EdgeRuntime.waitUntil(...)` and return `202 {job_id, cursor}` immediately. The DR control-room UI polls `dr_replication_state` (already wired).
- Per-table soft budget of 90s; on budget exhaust, save cursor + `status='resumable'` and exit 200.

---

## Group D — Frontend "Failed to fetch" noise (P1)

**Clusters:** 7 (/analytics), 8 (/settings, 5 occ), 10 (/dashboard), 11 (/auth), 12 (/leads), 14 (/system-health), 16 (/pt-sessions **11 occ**) — **25 occurrences**, all `TypeError: Failed to fetch`.

**Root cause.** These are **secondary effects** of Groups A + C (gateway 5xx + replicate timeouts) plus genuine offline blips. `src/services/errorLogService.ts` already drops them when `navigator.onLine === false`, but the conditional only drops `Load failed` / generic `Failed to fetch`, not Supabase REST `Failed to fetch` while the gateway briefly 5xx's.

**Fix** (one file): `src/services/errorLogService.ts`:
- In the `window.fetch` wrap, when the URL is a Supabase host AND the response is `502/503/504`, log as `warning` (not `error`) and **collapse** by URL pathname so 11 fetches of `/pt-sessions` ≠ 11 unique errors.
- For `TypeError: Failed to fetch` on Supabase host within 30s of a prior identical fetch failure, dedupe (already partly done — extend the dedupe window from "last entry" to "any in queue within 30s").
- Once Group A & C land, this noise drops naturally.

---

## Group E — PT package enum mismatch (P2)

**Clusters:** 17, 18 (1 occ each, 2026-05-28).

**Root cause.** Single old client build still sending legacy `package_type='duration_based'` after the `pt_package_type` enum was migrated to `('session_based','monthly')` in migration `20260517145246`. Verified current `src/components/pt/*` + `src/services/ptService.ts` only emit `session_based`/`monthly`. The "duration_months > 0" trigger error is the DB correctly enforcing the new contract.

**Fix.** No code change needed — already resolved by the May 17 migration + UI cutover. **Add a one-line backstop** in `src/components/pt/EditPTPackageDrawer.tsx` `onSubmit`: if `package_type==='monthly' && !duration_months`, block the submit with a toast (currently relies on DB error). Defensive only; closes the cluster permanently.

---

## Group F — Informational logs leaking into error counts (INFO / hygiene)

**Clusters:** 2, 3, 5, 6 (whatsapp_brain `brain_start` / `brain_end`), 4 (bot_paused) — **12 entries, all `severity: info`/`warning`**.

**Root cause.** These are normal lifecycle logs. They appear in the audit because the SystemHealth view doesn't pre-filter `severity in ('info','warning')` when computing "error clusters".

**Fix.** UI-only: `src/pages/SystemHealth*` (whichever lists clusters) — default the cluster grid filter to `severity in ('error','critical')` with a chip to opt-in to warnings/info. No backend change. (Aligns with "AI must respect UI/UX knowledge base" — surface, don't suppress.)

---

## Group G — `AbortError: signal is aborted without reason` on `/auth` (P2)

**Cluster:** 19 (1 occ).

**Root cause.** Supabase JS internally aborts an in-flight `getSession` when the route unmounts during the initial auth bootstrap (user clicked away from `/auth` before the request settled). Benign.

**Fix.** `src/services/errorLogService.ts` `shouldDrop()` — add `if (msg.includes('signal is aborted'))` to the drop list.

---

## Severity & sequencing

| Order | Group | Files touched | Why first |
| --- | --- | --- | --- |
| 1 | **B** template hygiene | `_shared/dispatch-communication`, send-whatsapp callers, WA automations UI chip | 58/119 occurrences |
| 2 | **A** cold-start retry | `automation-brain/index.ts` | 20 occurrences, recurring daily |
| 3 | **C** dr-replicate chunking | `dr-replicate/index.ts` | unblocks DR runbook |
| 4 | **D** + **F** + **G** noise reduction | `errorLogService.ts`, SystemHealth filter | makes the next audit usable |
| 5 | **E** PT defensive guard | `EditPTPackageDrawer.tsx` | tiny |

---

## Verification checklist

- After A: re-run `automation-brain` 10× via Run Now; expect zero `severity=error` rows for the four rule keys.
- After B: pick one branch missing `internal_lead_alert`, fire a fake lead → confirm one `severity=warning` log with `reason='no_approved_team_alert_template'` and SMS/email still delivered.
- After C: trigger DR replicate on full branch; confirm 202 + `dr_replication_state.status='resumable'` and final `completed` within 3 ticks.
- After D/F/G: load `/system-health`, confirm error count drops from 22 clusters → ≤ 5 (Group B residual until templates re-approved + Group E historical).
- Run `psql` `select source, severity, count(*) from error_events where created_at > now()-interval '24h' group by 1,2 order by 3 desc;` to confirm.

---

## Out of scope (explicitly not touched)

- AI Brain prompt / knowledge base (separate request, already on v4.0.0 pre-fetch injection).
- `bot_paused` behaviour (intentional, per memory).
- Adding new files — this plan edits **5 existing files** + 1 UI filter; zero new files.
