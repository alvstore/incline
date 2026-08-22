# Sprint: Access Feed, Blocking, Birthdays, Trainer UX, AI Brain

Five workstreams. Each is independent and can ship in order.

---

## 1. Live Access Feed — session consolidation (redesign)

Today the feed is a raw event tape. `deduplicateEvents()` in `LiveAccessLog.tsx` only collapses identical `member_id + result` inside a 60-second window, so a trainer punching several times, or an unmatched MIPS person (`VISIT1 / VISITOR`), floods the list with near-identical "Accepted" rows.

Redesign to a **presence-and-session model**:

- **Top strip — "In the gym now"**: live count of people currently inside (members / staff / trainers / unknown), with avatar stack and a filter chip per group.
- **Body — one row per person per day**, not per scan. Each row shows: avatar, name (or MIPS person label when unmatched), role badge, first-in time, last-seen time, total time inside, and a compact `IN·OUT` chip trail (e.g. `08:12 IN · 09:40 OUT · 17:05 IN`). Repeat punches inside a short window collapse into the existing chip with an `x3` counter instead of new rows.
- **Expandable row** reveals the raw scan list with device SN, result, payload viewer (keeps today's debugging power, hidden by default).
- **Unmatched MIPS people** (VISITOR/VISIT1 etc.) group into a single "Unmatched from MIPS" section with a "Link to CRM person" action that opens a right-side drawer to map the MIPS person to a member/employee (uses existing `mips_person_aliases`), plus a "Dismiss / mark as visitor" action so it stops re-alerting every sync.
- **Duplicate check-in notice** (`already checked in today`) becomes a subtle inline chip on the person's row instead of its own feed entry.
- Sticky header, skeleton loading, empty state, `rounded-2xl` cards, soft slate shadows, lucide icons only — per the project design system.

Grouping/session logic lives in a new pure module (`src/lib/devices/accessSessions.ts`) so it is testable and reusable by the dashboard.

---

## 2. Block Contact — CRM + Meta

The menu item exists but is permanently `disabled`. Implement it:

- **CRM side**: blocking sets `do_not_contact` on the conversation's chat settings/lead/member (the existing Do-Not-Contact contract), turns off the AI bot for that thread, hides the composer, and marks the thread with a red "Blocked" badge. A blocked thread stops all outbound dispatch (dispatcher already honours `do_not_contact`).
- **Meta side (WhatsApp)**: call the WhatsApp Cloud API block-list endpoint on the branch's phone number ID from a server edge function so inbound messages stop reaching us at Meta level. Unblock is the reverse call.
- **Instagram / Messenger**: Meta exposes no block API for DMs, so those threads get CRM-side suppression only, and the UI says so plainly instead of promising a Meta block.
- Confirmation uses an AlertDialog (destructive confirm is the allowed modal case); an "Unblock" entry replaces the item once blocked.

---

## 3. Birthdays — include staff, trainers and employees

`get_upcoming_birthdays` only reads `public.members`. Extend the RPC to union members with employees/trainers (profile `date_of_birth`, active staff only, branch-scoped the same way), returning a `person_type` field (`member` / `trainer` / `staff`).

`BirthdayWidget` then renders a role badge next to each name and keeps the Today / Upcoming split. Greeting action stays member-only for now unless you want staff wishes too.

---

## 4. Trainer Dashboard — visual overhaul

`TrainerDashboard.tsx` does not match the owner/admin surface. Rebuild it on the same theme engine:

- **Hero band**: gradient indigo/violet card — trainer name, avatar, today's date, clock-in state (MIPS-aware) with a single primary action.
- **KPI row**: today's sessions, week completion rate, active clients, PT hours this month — as gradient/soft-shadow stat cards with trend deltas and skeletons.
- **Today's schedule**: timeline column with per-session status badges, member avatar, quick "mark attended / no-show" actions.
- **My clients**: compact roster cards with plan expiry chips and last-visit recency.
- **Right rail**: attendance streak, pending tasks, upcoming birthdays of assigned clients.
- Mobile: single column, `100dvh`, safe-area padding; all touch targets ≥44px; every card `rounded-2xl` with soft slate shadow, no flat borders.

No business logic changes — data hooks stay as they are.

---

## 5. AI Agent (Ananya) — from scripted to genuinely smart

The brain is currently constrained by deterministic guards and a thin prompt, so it reads like a robot. Re-engineer:

- **Prompt architecture** (`_shared/ai-prompt.ts`): a full persona brief for Ananya — Incline's Udaipur concierge; Hinglish-fluent; warm, concise, never repeats herself; sells and services rather than interrogates. Explicit sections for facility authority (100% AC, no ceiling fans, recovery suites, sauna, cold plunge, Panatta strength floor), the pricing/opening-date blackout, and the escalation rules.
- **Let the model reason**: raise the reasoning/response budget, stop truncating context, and pass a richer runtime block (who the person is, membership/PT/dues state, last visit, open tasks) so it answers from facts rather than asking for the same details again.
- **Tool-calling instead of hardcoded ladders**: expose the existing CRM tools (lookup member, PT balance, timings, book/enquire, create lead, hand off to staff) so the model chooses actions, with a proper multi-step loop and approval on anything that mutates data.
- **Structured turn output**: intent, sentiment, captured fields (name/goal/plan interest), `wants_human`, confidence — used to drive lead updates and handoff instead of regex gates.
- **Anti-repetition** stays, but as a rephrase-with-context step, never a canned "may I have your name first?" overwrite.
- **Self-improvement loop**: every conversation that ends in a handoff, a conversion, or a bad-sentiment turn is logged as a learning candidate; a nightly job clusters them into proposed knowledge entries in `ai_dynamic_memory_suggestions` for one-click approval into `ai_knowledge`, which is already embedded and retrieved per message. That is how she gets sharper day by day, with a human approving what she learns.
- Verify with real messages through the live webhook path after deploy.

---

## Technical notes

- New: `src/lib/devices/accessSessions.ts` (session grouping), a link-MIPS-person drawer, block/unblock edge function path, migration extending `get_upcoming_birthdays`, migration/cron for the AI learning digest.
- Edited: `LiveAccessLog.tsx`, `WhatsAppChat.tsx`, `BirthdayWidget.tsx`, `TrainerDashboard.tsx`, `_shared/ai-prompt.ts`, `_shared/ai-agent-brain.ts`.
- All queries stay on TanStack Query with branch scoping and RBAC checks; all data entry stays in right-side Sheets.

---

## Sequencing

1. Live Access Feed redesign
2. Block Contact (CRM + WhatsApp)
3. Birthdays for staff/trainers
4. Trainer Dashboard overhaul
5. AI brain re-engineering + learning loop
