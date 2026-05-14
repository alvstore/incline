# WhatsApp AI Brain — 5-option lists, plan capture, agent presence & flow hardening

Noted on **Graph API v25.0** (released Feb 18, 2026 — latest stable). The interactive-message limits did not change in v25:
- **Reply buttons:** still hard-capped at **3**
- **Interactive list:** up to **10 rows per section**, multiple sections — this is the only way to show 5 options in one bubble
- **Flows messages:** richer multi-screen forms, also unchanged
- v25 mainly adds Calling API GA + new template categories; nothing relevant to our quick-reply flow

So the fix is the same: switch from buttons (3) → list (5–10).

---

## 1. Show 5+ options instead of 3

Today the AI brain prompt (`whatsapp-webhook/index.ts` lines 1097–1124, `_shared/ai-agent-brain.ts` lines 174–211) tells the model "max 3 options" and falls back to plain numbered text when there are more. The plumbing for `interactive_list` already exists (lines 1642–1651) and maps cleanly to Meta `type: list`.

**Changes:**
- Drop the "max 3" wording. New rule in both prompts: *"1–3 choices → buttons. 4–10 choices → MUST emit `interactive_list`. Never emit a plain "1. … 2. … 3. … 4. … 5. …" text list."* Worked example with the 5-goal scenario from the message.
- Bump the JSON examples to use realistic 5-option payloads.
- **Runtime safety net** in the parser (around line 1630): if model still returns `type:"interactive"` with `buttons.length > 3`, auto-promote to a single-section `interactive_list` instead of silently slicing to the first 3.
- Same change to plain-text fallback: if reply text contains a numbered list with ≥4 items and we have an interactive channel, repackage as a list.
- Pin the Graph API base path to `/v25.0/` everywhere it appears (today some calls use older versions — quick grep + bump).

## 2. Audit & fix membership-plan-interest capture

Confirmed the gap: lead-capture target_fields are name / phone / email / goal / budget / start_date / experience / preferred_time (`AIFlowBuilderSettings.tsx` lines 17–26, brain field map at lines 196–202). **No "interested plan duration"** field anywhere → the AI never asks Monthly / Quarterly / Half-Yearly / Annual.

**Changes:**
- Add `plan_interest` ("Interested Plan Duration") to:
  - `AVAILABLE_FIELDS` in `AIFlowBuilderSettings.tsx`
  - `fieldLabels` in both `whatsapp-webhook/index.ts` and `_shared/ai-agent-brain.ts`
  - `leads` table — migration adds `plan_interest text` (nullable)
- Wire the brain to read **actual plan rows** from `membership_plans` (already hydrated in `ai-agent-brain.ts` lines 324–344) and offer the gym's real durations as the 5-option list — kills two birds.
- Default new flow configs to include `plan_interest` when lead capture is enabled, and surface it in the leads table / detail view so sales can sort by it.

## 3. Multi-device agent presence (typing / viewing)

`WhatsAppChat.tsx` has zero presence layer today, so two staff on web + mobile + desktop can both reply to the same lead. Same Supabase user across devices, so we just need a presence channel per conversation.

**Changes (frontend-only, Supabase Realtime presence — no extra infra):**
- New hook `useConversationPresence(conversationId)` joining channel `whatsapp:conv:<id>` and tracking `{ user_id, name, avatar, status: 'viewing' | 'typing', ts }`.
- New `<AgentPresenceBar />` in the conversation pane:
  - Avatar pills of other agents currently viewing → "Priya is viewing", "Rahul is typing…"
  - Soft-warn before sending if another agent is typing in the same convo: *"Rahul is also replying — send anyway?"*
  - Broadcast `agent_replied` on send so others see "Rahul just replied 2s ago" toast.
- Throttle typing events to 1/sec, auto-clear after 4s idle.
- Fully ephemeral (no DB writes). Works on web, mobile PWA, and desktop because they share the Supabase auth session.

## 4. Make the automation flow more robust

Targeted hardening of failure modes seen in production logs:

- **Sticky lead progress per contact:** persist `lead_capture_progress` (JSONB) on `whatsapp_contacts` so the brain can't loop ("name?" → "name?" → "name?") on flaky JSON parses across turns.
- **Robust JSON repair:** today's regex only catches single-line `{…}`. Replace with a brace-matched extractor that handles multi-line JSON and ```json``` markdown fences.
- **Repeat-question guard:** keep `last_3_questions` in conversation memory; if the model tries to ask the same one 3× in a row → force `transfer_to_human`.
- **Tool-error two-strike rule:** documented in the prompt but not enforced. Track `consecutive_tool_errors` on the conversation row, auto-handoff at 2.
- **Send-time race lock:** before calling Meta `/v25.0/<phone_id>/messages`, take a 5-second `pg_advisory_xact_lock(hashtext('wa:'||conversation_id))` so two concurrent webhook invocations (Meta retries) can't double-reply.
- **Lead-JSON resilience:** if the model emits the lead-captured JSON but is missing required fields, today we silently drop it. Instead → log to `automation_diagnostics`, ask only for the missing field, do not reset progress.

---

## Technical details

Files touched:
- `supabase/functions/whatsapp-webhook/index.ts` — prompt rewrite, list-promotion, JSON repair, advisory lock, repeat & error guards, v25 path pin
- `supabase/functions/_shared/ai-agent-brain.ts` — same prompt + field-label changes for omnichannel agent
- `src/components/settings/AIFlowBuilderSettings.tsx` — add `plan_interest` field
- `src/pages/WhatsAppChat.tsx` + new `src/hooks/useConversationPresence.ts` + `AgentPresenceBar.tsx` — presence UI
- Migration: `leads.plan_interest text`, `whatsapp_contacts.lead_capture_progress jsonb default '{}'::jsonb`, `automation_diagnostics` table for dropped JSON & repeat-loop incidents

Non-goals (ask if you want them):
- Replacing the brain with the Vercel AI SDK / proper agent loop refactor
- Building a Flows-message onboarding (vs. simple list)
- Hard "claim conversation" lock (vs. soft presence warning)
- Adopting any v25-only features (Calling API, new template categories) — those are separate asks

I'll ship in two waves once approved: **(a)** v25 pin + 5-option list + plan_interest + migration, **(b)** agent presence + robustness hardening.
