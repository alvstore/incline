# Automation Brain — Redesign + Instagram DM consolidation

## Goals
1. **Single source of truth** for *every* scheduled background job (incl. Instagram Comment-to-DM).
2. **Redesigned control room** — denser, scannable, with clearer health signals and faster edit/run flow.
3. Keep Vuexy tokens locked (Indigo/Violet, `rounded-2xl`, slate shadows).

---

## Part A — Move Instagram DM into Automation Brain

### Current state
- `process-ig-comment-runs` edge fn runs on its **own dedicated `pg_cron`** (every 1 min).
- Lives outside the `automation_rules` registry → not visible / pausable from the control room.
- The IG **management UI** (campaigns, keywords, approval queue, runs log) lives in `Announcements → Instagram` and is *content management*, not orchestration. It stays where it is.

### Migration
1. Register a new row in `automation_rules`:
   - `key = 'process_ig_comment_runs'`
   - `category = 'engagement'`
   - `worker = 'edge:process-ig-comment-runs'`
   - `cron_expression = '*/1 * * * *'` (we keep 1‑min cadence — IG DMs are time-sensitive)
   - `is_system = true`, `is_active = true`
2. Teach `automation-brain-tick` to dispatch `edge:process-ig-comment-runs` (already generic — just confirm worker prefix is supported).
3. **Drop the standalone `pg_cron` job** for IG runs (replaced by master tick).
4. Add a deep-link button on the rule row → *"Manage campaigns"* → `/announcements?tab=instagram`.

Result: pausing/editing/Run-now for IG DMs works exactly like every other rule; the campaign editor stays where staff already manage IG content.

---

## Part B — Control Room redesign

### Information architecture (single page, three zones)

```
┌─ Header ─────────────────────────────────────────────────────┐
│  Automation Brain  ·  Master tick: every 5 min  · [Run tick] │
├─ Health strip (4 KPI tiles) ─────────────────────────────────┤
│  Active rules · Runs 24h · Failures 24h · Dispatched 24h     │
├─ Toolbar ────────────────────────────────────────────────────┤
│  [Search] [Category ▾] [Status ▾] [AI only ☐] [Failing only☐]│
├─ Rules (grouped, collapsible) ───────────────────────────────┤
│  ▸ Billing (3)                                               │
│  ▾ Engagement (5)                                            │
│     ● Daily Reminders   ⏱ Daily 8:00  ✓ success 2h ago  [⋯]  │
│     ● IG Comment → DM   ⏱ Every 1m    ⚠ 2 errors        [⋯]  │
│  ▸ Lifecycle (2)                                             │
├─ Activity rail (right column on ≥lg, below on mobile) ───────┤
│  Live runs feed (auto-refresh 15s), filterable by rule       │
└──────────────────────────────────────────────────────────────┘
```

### Key UX upgrades
- **One row per rule** (not a card per rule) → ~2× density. Inline: name, AI chip, last-status badge, sparkline of last 10 runs, cron summary, last/next run, switch, ⋯ menu (Run now / Edit / View runs / Open target).
- **Category collapse** with counts + per-group failure badge so failing groups stay open.
- **Failing-only filter** — single click triage.
- **Health strip** gains a tiny trend (▲/▼ vs prior 24h) and turns rose when failures > 0.
- **Activity rail** replaces the bottom "Recent runs" card; persistent, click-to-filter by rule.
- **Edit Sheet** reorganised into three sections: *Identity* (name/desc) · *Schedule* (presets + cron + next-3-fire preview) · *AI personalisation* (toggle + tone + sample preview button calling `ai-test-purpose`).
- **System-rule guardrail** — system rules show a lock chip; only schedule + AI tone + name editable.
- **Empty / loading / error** states per Vuexy rules (skeleton rows, lucide-only icons, colored badges).

### Accessibility & perf
- Rule rows are buttons w/ visible focus ring; switches have aria-labels (already partly present).
- Virtualise the rules list only if >50 rows (currently 13 → not needed).
- Realtime via `useQuery` `refetchInterval` already in place; add Supabase Realtime subscription on `automation_runs` for the activity rail.

---

## Technical changes

### Database (migration)
- INSERT row into `automation_rules` for `process_ig_comment_runs`.
- DROP the legacy `cron.unschedule(...)` for the IG-specific job (via insert tool — user-data).

### Frontend
- Rewrite `src/components/settings/AutomationsControlRoom.tsx` into:
  - `AutomationsControlRoom.tsx` (shell + filters + KPIs)
  - `AutomationRuleRow.tsx` (single dense row)
  - `AutomationActivityRail.tsx` (live runs, realtime)
  - `AutomationEditSheet.tsx` (extracted, reorganised)
  - `lib/automations/cronHumanize.ts` (describe + next-3-runs via tiny cron parser)
- Add deep-link target buttons per rule key (e.g. IG → `/announcements?tab=instagram`, Reminders → `/settings?tab=communication-templates`).

### Edge / worker
- Confirm `automation-brain-tick` already handles `edge:*` workers generically (it does — `process_comm_retry_queue` uses the same pattern). No change beyond registering the row.
- Keep `process-ig-comment-runs` fn unchanged (it's idempotent; can be called by either cron or the brain).

### Cleanup
- Remove dedicated pg_cron entry for `process-ig-comment-runs` after the new rule is verified once via "Run now".
- Update memory index entry **Automation Brain** to note IG DMs are now orchestrated centrally.

---

## Out of scope
- IG campaign editor / approval queue UI (stays in `/announcements?tab=instagram`).
- Changing the master tick cadence (5 min) or worker contract.
- Multi-tenant / per-branch automation rules (already supported via `branch_id` filter; UI unchanged).

## Open question
Confirm: keep IG cadence at **1 min** (matches today) — or relax to **5 min** to align with the master tick (simpler, but +up-to-4-min DM latency).
