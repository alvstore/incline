## Audit findings

### Issue 1 — Job-seeker captured as fitness lead + raw JSON leaked into WhatsApp

A user wrote that they are looking for a sales job and uploaded a CV. The WhatsApp AI bot:
1. Replied politely ("I'll make sure this reaches our hiring team") **and then** appended the raw JSON of an `interactive_list` block asking for their fitness goal.
2. Treated the conversation as a fitness lead and ran the lead-capture flow.

Two distinct root causes:

**(a) Intent classifier missing in `_shared/ai-agent-brain.ts`.** The agent's system prompt is fitness-onboarding-first. There is no rule that says "if the user is a job seeker / vendor / press / partnership / complaint / wrong-number, do NOT capture a lead — redirect to `info@theinclinelife.com`."

**(b) Inline-JSON extractor in `supabase/functions/whatsapp-webhook/index.ts` (lines 1709–1719) is broken for nested JSON.** The "Try 3" regex is `\{[^{}]*"type"\s*:\s*"interactive[^{}]*\}` — `[^{}]*` cannot match nested braces, and the `interactive_list` payload contains nested `sections[].rows[]` objects. So when the AI mixes prose + JSON ("Received! …\n{interactive_list…}"), Try 1 (whole-string JSON), Try 2 (markdown fence), and Try 3 (inline) all fail and the raw JSON falls through to `sendWhatsApp` as plain text — exactly what the user saw.

### Issue 2 — Yogita did not receive WhatsApp lead alert; Rajat did

Both admins are in `lead_notification_admin_prefs` with `whatsapp_enabled = true`, both have phones on profiles, and `notify-lead-created` logs `status='sent'` for both (`provider_message_id` is NULL because the function doesn't capture Meta's response id). Inbox history:

| Admin | inbound msgs to business WA | last inbound |
|---|---|---|
| Rajat (+91 98876 01200) | 13 | 2026‑05‑14 (today) |
| Yogita (+91 99289 10901) | **0** | — |

This is a **Meta WhatsApp Cloud API 24‑hour customer-service window** constraint, not a code bug. `notify-lead-created → sendWhatsApp` posts a free-form `type: "text"` message. Meta only delivers free-form text if the recipient sent an inbound message to the business number within the last 24h. Rajat replies regularly so his window is open. Yogita has never messaged the business number → Meta accepts the API call (HTTP 2xx) but silently drops delivery. Hence the log says "sent" but her phone never rings.

The fix is to send team alerts via a **pre-approved WhatsApp HSM template** (templates can be sent any time, no 24h window). We already have `whatsapp_templates` infra and the canonical dispatcher (`dispatch-communication`) handles template payloads + delivery webhooks.

---

## Plan

### 1. Fix the inline-JSON extractor (whatsapp-webhook)

In `supabase/functions/whatsapp-webhook/index.ts` (`tryExtractInteractiveJson`, ~L1689):
- Add a **brace-balanced scanner**: find the first `{"type":"interactive` (or `"type": "interactive_list"`), then walk forward counting `{`/`}` (respecting strings) until balanced — extract that substring and `JSON.parse`.
- Use this scanner BEFORE the current Try 3 (and replace Try 3 entirely).
- Keep Try 1 (pure JSON) and Try 2 (markdown fence) unchanged.
- Bump the `// version` header comment.

This guarantees that any future "prose + interactive_list JSON" reply is split correctly: prose goes as a text message (or is dropped if it duplicates `parsed.body`), and the `interactive_list` is sent as a real Meta interactive list block.

### 2. Add non-fitness intent guard to the AI brain

In `supabase/functions/_shared/ai-agent-brain.ts` system prompt:
- New section "NON-FITNESS INTENTS — DO NOT CAPTURE AS LEAD". Cover: job application / careers / CV / resume, vendor / supplier inquiry, press / media, partnership / collaboration, complaint about an existing member's experience, wrong number, generic greeting with no fitness intent.
- For each, the AI MUST: (a) NOT call the `capture_lead` tool; (b) NOT ask the fitness-goal / plan / branch onboarding questions; (c) reply with a short, branded redirect:
  > "Thanks for reaching out! For **careers, partnerships, vendor, or media** inquiries please email **info@theinclinelife.com** or call our front desk. Our WhatsApp here is for membership and fitness queries only."
- Mirror the same rule in `whatsapp-webhook/index.ts`'s inline system prompt block (~L1101–1146) so both code paths agree.
- Also add a server-side guard in the `capture_lead` tool executor (`_shared/ai-tool-executor.ts`): if the agent's reasoning mentions "job"/"resume"/"cv"/"hiring"/"vendor"/"press" in the lead `notes`, skip the insert and return a `skipped: not_a_fitness_lead` result — defence in depth.

### 3. Switch lead-team-alert WhatsApp to a template (fixes Yogita)

In `supabase/functions/notify-lead-created/index.ts`:
- Replace the direct free-form `sendWhatsApp` call for **team alerts** (admins + managers) with a call to `dispatch-communication` using `category: 'lead_alert_team'`, `channel: 'whatsapp'`, and template variables `{lead_name, lead_phone, lead_source, branch_name}`.
- Lead-facing welcome WhatsApp stays as-is (the lead just messaged us, so their 24h window is open).
- Add a new approved template row in `whatsapp_templates` named `lead_alert_team_v1` with body matching the current text (`🔔 New Lead Alert\nName: {{1}}\nPhone: {{2}}\nSource: {{3}}\nBranch: {{4}}`). Operator must submit this template in Meta Business Manager and mark it `status='approved'` once Meta approves it. Until then, fall back to free-form (current behaviour) so we don't break Rajat's notifications.
- Capture `provider_message_id` and `delivery_metadata` from Meta's response into `communication_logs` so future "did it actually reach?" audits don't have to guess.

### 4. UI / settings polish

- In **Settings → Lead Notification Rules → Team Alerts**, add a small inline note next to "WhatsApp to Admins":
  > "Admins must have an approved WhatsApp template OR have messaged the business number in the last 24 hours, otherwise Meta silently drops the message."
- In **Communications → Live Feed**, when a row has `status='sent'` but `provider_message_id IS NULL` AND age > 5 min, show an amber "Unconfirmed delivery" sub-badge (so we visually catch silent drops like Yogita's).

### 5. Verify

- Send a test lead from `/embed-lead-form`. Confirm: (a) Rajat receives WA (24h window open), (b) Yogita receives WA via the template send (after Meta approves the template) or shows "Unconfirmed delivery" badge until then, (c) only ONE WA per admin per lead (atomic claim via `notified_at` is already in place), (d) one in-app notification only.
- Send a test inbound on the business WA: "Hi I'm looking for a job in sales, here's my CV" → confirm AI replies with the careers redirect, does NOT call `capture_lead`, and does NOT ask fitness-goal.
- Send a test inbound that triggers the fitness-goal interactive list → confirm the user sees a real WhatsApp list UI (not raw JSON).

### Technical notes

- Files touched: `supabase/functions/whatsapp-webhook/index.ts`, `supabase/functions/_shared/ai-agent-brain.ts`, `supabase/functions/_shared/ai-tool-executor.ts`, `supabase/functions/notify-lead-created/index.ts`, one migration to seed the `lead_alert_team_v1` row in `whatsapp_templates`, and `src/components/settings/LeadNotificationSettings.tsx` + the Live Feed row component for the UI hints.
- No schema changes beyond the template seed row.
- Memory updates: append a "Meta 24h window — team alerts must be templates" rule to `mem://integrations/whatsapp-business-api-v25-0` and a "AI brain must reject non-fitness intents" rule to `mem://integrations/whatsapp-transactional-ai-agent`.