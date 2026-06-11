## What you're seeing — diagnosis

The four `brain_start …` / `brain_end …` rows in System Health → Errors are **not actual errors**. They are intentional **heartbeat breadcrumbs** written by `supabase/functions/whatsapp-webhook/index.ts` (v6.5.0, lines 471–533) every time the WhatsApp AI brain runs.

- `brain_start <phone>` is logged **before** invoking the unified AI agent.
- `brain_end <phone>` is logged **after** the agent returns successfully (with `took_ms`).
- Both rows are written with `severity = 'info'`, `source = 'whatsapp_brain'`, `status = 'open'`.
- Purpose: a `start` row with **no matching `end` within 90 s** is conclusive proof that an edge worker was reaped mid-LLM call (previously these failures were silent). The "Stalled Conversations" detector relies on this.

DB confirms the pattern (no real error):

```text
whatsapp_brain   | info     | 4   ← heartbeats (these 4 rows)
frontend         | error    | 2   ← actual "Network error - check your internet"
automation_brain | warning  | 1   ← process_ig_comment_runs warning
```

Counts of 3 / 4 in the screenshot = how many times the same phone was processed (fingerprint dedupe with `occurrence_count`).

### Why they look like errors in the UI
`SystemHealth.tsx` lists every row in `error_logs` regardless of severity. Info-level heartbeats stay `open` forever because nothing ever resolves them, so they accumulate next to real errors and inflate the "open" count.

---

## Plan to fix (UX cleanup, keep the safety net)

Goal: keep the heartbeat safety net (so we can still detect stalled brain runs), but stop polluting the Errors view with paired success heartbeats.

### 1. Auto-resolve matched heartbeats (DB migration)
Add a trigger on `error_logs`: when a `brain_end <phone>` row is inserted/updated, mark the matching open `brain_start <phone>` row with the same `context->>'message_id'` as `status = 'resolved'`, then also auto-resolve the `brain_end` row itself. Only an **unmatched** `brain_start` (the actual stalled-worker signal) remains open.

### 2. Hide info-severity heartbeats from default view (frontend)
`src/pages/SystemHealth.tsx`:
- Add a default filter `severity != 'info'` on the main query.
- Add a "Show heartbeats / info" toggle (off by default) so the data is still inspectable.
- Update `criticalOpen` / open-count tiles to ignore `info` severity.

### 3. Backfill existing 4 rows
One-off SQL in the same migration: resolve the 4 existing `whatsapp_brain` info rows (they all have matching start/end pairs already).

### 4. Memory update
Append a one-liner to `mem://index.md` Core: *"`error_logs` rows with `source='whatsapp_brain'` and severity `info` are heartbeats, not errors — auto-resolved by trigger; SystemHealth hides `severity=info` by default."*

---

### Technical details
- Files touched: `supabase/migrations/<ts>_brain_heartbeat_autoresolve.sql` (new), `src/pages/SystemHealth.tsx` (filter + toggle), `mem://index.md`.
- No change to `whatsapp-webhook` — heartbeats keep firing exactly as today.
- The other open rows (2 frontend "Network error" + 1 `process_ig_comment_runs` warning) are out of scope for this cleanup; they are genuine user-side network blips and an automation warning. Happy to investigate those in a follow-up if you want.
