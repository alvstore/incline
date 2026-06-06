
## Why no reply went out

`runUnifiedAgent` (supabase/functions/_shared/ai-agent-brain.ts:148) short-circuits when `ai_purposes.ops_config.auto_reply_enabled` is false. That flag is currently `false` for `purpose='whatsapp_reply'`, so every inbound WhatsApp message is silently skipped with `auto_reply_disabled` — including Bhavyadeep's "Founding memberships" query.

The per-chat green "AI Bot" pill in the inbox only reflects `whatsapp_chat_settings.bot_active`, which is true. There is no UI signal that the global master is off, so the inbox looks healthy while nothing is replying.

## Step 1 — Restore the brain (data fix, one row)

Update the single global `whatsapp_reply` row via a migration:

- `ai_purposes.ops_config.auto_reply_enabled` → `true`
- Keep `channels.whatsapp.enabled = true`, instagram/messenger as-is (false)
- Leave `enabled`, `reply_delay_seconds`, prompts untouched

After the migration, manually trigger one inbound smoke test (re-send a WhatsApp from a test number) and verify a reply lands in `whatsapp_messages` with `direction='outbound'`.

## Step 2 — Make the inbox AI Bot pill tell the truth

In `src/components/whatsapp/...` (the chat header that renders the `AI Bot` toggle next to the contact name):

- Fetch the global `ai_purposes` row for `purpose='whatsapp_reply'` (TanStack Query, cached) and read `ops_config.auto_reply_enabled` + `ops_config.channels.whatsapp.enabled`.
- Effective state = `bot_active AND auto_reply_enabled AND channels.whatsapp.enabled AND NOT do_not_contact`.
- When the master is OFF but `bot_active` is true, render the pill in amber with a tooltip: "Per-chat AI is on, but the global WhatsApp auto-reply is OFF in AI Control Center. No replies will be sent."
- Add a small inline link "Open AI Control Center" to the WhatsApp Coverage & AI page so staff can fix it in one click.

No edge function changes, no schema changes.

## Step 3 — Add a health card in AI Control Center

In the WhatsApp Coverage & AI screen (`src/pages/settings/...` for `whatsapp_reply`):

- Add a top status banner that shows the live effective state of the brain: Master switch · Channel switches · Last 24h reply count from `whatsapp_messages` (direction='outbound', sent_by='ai').
- If `auto_reply_enabled=false` while channel toggles are on, show a red "Auto-reply master is OFF — no inbound WhatsApp gets a bot reply" callout with the toggle right there.

This is purely presentation; reads existing `ai_purposes` + `whatsapp_messages`.

## Step 4 — Backfill Bhavyadeep manually (one-time)

His message is sitting unread. After step 1 ships, he's outside the 24h Meta freeform window if we wait — so:

- Send him the founder's-phase opening (Meta-approved template, not freeform) from the inbox, capturing him into the WhatsApp onboarding flow. The lead row already exists (`a91dad34…`, source=website, branch=INCLINE) so no duplicate.

Step 4 is operator action, not code.

## Out of scope

- No changes to `whatsapp-webhook`, `ai-agent-brain`, `dispatch-communication`, or lead capture logic.
- No DB schema changes.
- No changes to per-chat `bot_active` semantics.

## Verification

1. After the data fix, send a fresh WhatsApp inbound from a test number; confirm an outbound row appears within ~5s and `edge_function_logs(whatsapp-webhook)` shows no `auto_reply_disabled` skip.
2. Open the inbox: amber state should disappear once master is back ON; switch master off in staging to confirm the amber + tooltip render correctly.
3. AI Control Center health card shows `Auto-reply: ON · WhatsApp channel: ON · Replies (24h): >0`.

Skills used: senior-architect (root-cause flow tracing), code-reviewer (gate audit in `ai-agent-brain.ts`), ui-ux-pro-max + senior-frontend (honest-state pill + health card).
