## Goals

1. **Task delete with RBAC** (owner + admin + manager).
2. **AI Training rules — backfill + smarter matching** so the dynamic memory covers all hardcoded intents and stays in sync.
3. **Stop promising "we'll call you back"** in the Founding Member handoff, and instead **auto-create a Task** for owner/admin/manager with full notifications.

---

## 1. Task Delete (Mission Control)

**Capability**
- Add `delete_task` to `Capability` matrix in `src/lib/auth/permissions.ts` → `['owner','admin','manager']`, plus `can.deleteTask`.
- Mirror as a row in `role_capabilities` (server) for parity.

**UI**
- `TaskDetailDrawer.tsx`: footer gets a destructive **Delete task** button (left-aligned, `variant="ghost"` + red icon) wrapped in `AlertDialog` ("Delete this task? This cannot be undone."). Visible only when `can.deleteTask(roles)`.
- `TaskCard.tsx` + row in `TaskListView.tsx`: add `DropdownMenu` (three-dot) with **Delete** entry, same RBAC gate, same confirm dialog.
- On confirm → `taskService.deleteTask(id)` (already exists) → `queryClient.invalidateQueries({queryKey:['tasks']})` + stats + toast.

**Audit**
- DB trigger on `tasks` already writes audit_logs; nothing new.

---

## 2. AI Training — Backfill & Smarter Matching

**Backfill seed (insert tool, not migration)** — add rules so the Hinglish dictionary, fake-name tokens, pricing/timeline/location/handoff regexes, and PT/decline phrases all live in `ai_dynamic_memory`. Categories already supported: `location | pricing | timeline | handoff | decline | name_block | custom`. New rows include:

- **Location:** "kha pr h", "kaha hai", "kidhar", "location", "address", "where is gym", "udaipur me kahan"
- **Pricing:** "kitna", "price", "fees", "paisa", "kitne ka", "rate kya", "monthly kitna", "charges"
- **Timeline:** "kab khulega", "opening kab", "launch when", "kab tak", "start kab"
- **Handoff:** "talk to human", "call me", "agent se baat", "person se", "manager se baat"
- **Decline:** "no phone", "don't call", "mat call", "nahi number", "phone share nahi"
- **Name-block (fake names):** "test", "abc", "xyz", "asdf", "user", "guest", "anonymous", "hi", "hello", "ok", "fitness", "gym", "trainer", "vip", "founding", "member"

**Schema upgrade (migration)** — add a few columns so admins can train more precisely without code changes:
- `language` enum (`en | hi | hinglish | any`) default `any` — for analytics + tone hints.
- `examples jsonb` — array of sample messages the rule fires on (used by the in-UI tester to show coverage).
- `last_matched_at timestamptz`, `match_count int default 0` — populated by the brain when a rule fires; lets admins see "dead" rules.
- `created_via text default 'admin'` (admin | seed | ai_suggested) — flags AI-suggested rows for review.

**Brain integration upgrades** (`ai-dynamic-memory.ts` + `ai-agent-brain.ts`)
- **Word-boundary contains**: today `contains` is naive substring. Switch to `\b{phrase}\b` regex for `match_type='contains'` so "ok" doesn't match "okra".
- **Hot-reload**: shrink cache TTL to 30s + invalidate cache via a Postgres `NOTIFY` listener triggered by `ai_dynamic_memory` upsert (edge fn calls `loadDynamicMemory({force:true})` on tick).
- **Telemetry**: every match increments `match_count` and stamps `last_matched_at` via a fire-and-forget RPC `bump_dynamic_memory_hit(id)`.
- **Auto-suggest loop**: when AI replies fall back to LLM (no rule matched) but message scores high intent-confidence from the LLM, log a row in new table `ai_dynamic_memory_suggestions` (`phrase, suggested_intent, sample_message, source_conversation_id, status='pending'`). Admin UI surfaces these for one-click promotion.

**Admin UI enhancements (`AITrainingTab.tsx` + `AITrainingRuleSheet.tsx`)**
- New "Suggestions" tab listing `ai_dynamic_memory_suggestions` (pending review) with **Promote** / **Dismiss** actions.
- Column **Last fired** + **Hits** on the main table; dead-rule badge (no hits >30d).
- Bulk-import CSV: pre-built CSV templates per intent so the team can paste WhatsApp transcripts and bulk-train.
- Live tester now shows: matched rule, expected pivot prefix, AND language detection.

---

## 3. Founder's Phase — No more fake "we'll call you" + Auto-Task

**Problem:** When user (e.g. Jenil) confirms Annual Founding Member interest, AI replies _"I've asked our Founder's Team to give you a call to finalize your VIP reservation… They will reach out to you shortly"_. Nothing actually happens — no task, no notification — so the promise is a lie.

**Fix — two changes:**

**A. Rewrite the deterministic confirmation copy** in `ai-agent-brain.ts` (the "Founding Member list" lines at L1227/1313/1387). New copy:

> "You're locked in on the Founding Member list, {firstName} ✨ One of our founders will personally walk you through your pre-launch onboarding — no need to chase, we'll reach out on this WhatsApp when your slot is ready."

Removes "call", "callback", "VIP reservation" wording — keeps the promise truthful (we DO reach out via WhatsApp; we don't promise a phone call we never schedule).

**B. Trigger real internal handoff via a new helper `triggerFounderHandoff(ctx, lead)`** invoked at the same point the Founding Member confirmation fires:

1. **Insert task** via service-role: `tasks.insert({ title: 'Founding Member follow-up — {name}', description: 'Lead confirmed Annual Founding Member interest on WhatsApp. Reach out for onboarding walkthrough.', priority: 'high', status: 'pending', due_date: now()+2h, linked_entity_type: 'lead', linked_entity_id: leadId, branch_id })`.
2. **Notify owner + admin + manager of that branch** through existing `notify-staff-handoff` edge fn (already routes to in-app, WhatsApp, email, SMS based on each user's `notification_preferences`). Pass `{ reason: 'founding_member_confirmed', leadId, taskId, channels: ['in_app','whatsapp','email','sms'] }`.
3. **Idempotency**: dedupe via `whatsapp_chat_settings.founder_handoff_task_id` column (new) — if set, skip recreating. New migration adds the column + index.
4. **Audit**: task insert already triggers audit; handoff also logs to `error_logs` with `severity='info'`, `source='founder_handoff'` for observability in System Health.

**Lead loop closure**
- `leads.lifecycle_stage` advanced to `qualified_handoff`.
- Task assignment: leave `assignee_id=null` (unassigned) so the assigned-via-RBAC pool in Mission Control picks it up; managers see it in the **Unassigned** filter immediately and can claim or assign.

---

## Files

**Edited**
- `src/lib/auth/permissions.ts` (+ `delete_task` capability)
- `src/components/tasks/TaskDetailDrawer.tsx`, `TaskCard.tsx`, `TaskListView.tsx` (delete UI)
- `supabase/functions/_shared/ai-dynamic-memory.ts` (word-boundary regex, hit telemetry, suggestions writer)
- `supabase/functions/_shared/ai-agent-brain.ts` (truthful copy + `triggerFounderHandoff` hook)
- `src/components/settings/ai/AITrainingTab.tsx`, `AITrainingRuleSheet.tsx` (suggestions tab, hits column, CSV import)

**New**
- Migration: `ai_dynamic_memory` adds `language`, `examples`, `last_matched_at`, `match_count`, `created_via`; new table `ai_dynamic_memory_suggestions`; new column `whatsapp_chat_settings.founder_handoff_task_id`; RPC `bump_dynamic_memory_hit(uuid)`.
- Insert script (via insert tool): seed ~50 backfill rules across intents.
- `src/components/settings/ai/AITrainingSuggestionsTab.tsx`.

**Out of scope** (acknowledged in earlier audit, not in this sprint)
- 502 cold-start auto-resolve + `bot_paused_timed` Resume banner — separate ticket.

---

## Validation

1. As `manager`: open task → see Delete → confirm → row disappears, list refreshes, audit_log shows DELETE.
2. As `staff`: Delete button absent in drawer + dropdown.
3. Send WhatsApp "kha pr h" → brain logs `[AI Tool Call Attempt] dynamic_memory_match {intent:'location'}`, `match_count` increments, reply pivots to location.
4. Confirm Annual Founding Member on WhatsApp → reply contains NO "call" / "callback"; one new task appears in Mission Control (Unassigned, high priority); owner/admin/manager receive in-app + WhatsApp + email notifications; second confirmation in same chat does NOT create duplicate task.
5. Admin UI: new "Suggestions" tab lists captured phrases; Promote creates a rule and removes the suggestion.