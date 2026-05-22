# Audit findings — IG chat header + AI parroting

## What the screenshot actually shows

Conversation `f7ace3d9-3b18-405d-b4e6-f885bd875d13` (platform `instagram`, IGSID `3513066218863423`):

- `contact_name` = NULL
- `contact_avatar_url` = NULL
- The "phone" `+3513066218863423` is **not a phone** — it is the Instagram Scoped ID rendered by `formatPhoneDisplay()` with a `+` slapped on the front.

## Issue 1 — IG header shows fake "+phone"

`src/pages/WhatsAppChat.tsx` line 1057-1060 always renders:

```tsx
<Phone className="h-3 w-3" />
{formatPhoneDisplay(selectedContact.phone_number)}
```

For IG/Messenger, `phone_number` is the IGSID/PSID, never a phone. `displayLabel()` already handles this for the title (`IG · 863423`), but the sub-line ignores platform.

**Fix:** branch on platform in the header sub-line:
- IG → `Instagram` icon + `@username` if known, else `IG ID · 3513066218863423` (full ID, monospace, muted)
- Messenger → `Facebook` icon + `Messenger ID · …`
- WhatsApp → existing `Phone` icon + `formatPhoneDisplay`

Same treatment in the chat-list row preview where a phone is shown next to IG/MSG contacts.

## Issue 2 — IG username "chinmay biswas" never resolved

`supabase/functions/meta-webhook/index.ts → resolveInstagramSenderProfile()` runs on first inbound IG message and writes `contact_name` + `contact_avatar_url`. For this thread it returned empty — almost certainly because the page access token on the IG integration lacks `instagram_basic` / `pages_messaging` scopes, or Meta returned `{}` (common when the user has never previously interacted with the Page).

Today the empty result is cached for **24 h** (`_igProfileCache`) and never retried on subsequent inbound messages, so the chat stays anonymous forever.

**Fix:**
1. **Do not cache empty results** — only cache when at least `name` or `username` came back. Failed lookups should retry on the next inbound message (cheap, one Graph call).
2. **Backfill action** — add a "Refresh Instagram profile" item to the chat-header `⋯` menu that calls `meta-admin` (already exports `resolveInstagramSenderProfile`) for the selected IGSID and upserts `whatsapp_chat_settings.contact_name/avatar_url` via `upsert_meta_contact_profile`. One-click rescue for any historical anonymous IG thread.
3. **Diagnostics log line** — when Graph returns 200 with empty body, log `[IG profile] empty body for IGSID=… token_scope=page|user` so we can spot scope problems in edge logs.
4. **One-off backfill** — run `backfill-meta-profiles` for current `whatsapp_chat_settings` rows where `platform='instagram' AND contact_name IS NULL` (29 rows max based on quick count).

No DB schema changes required.

## Issue 3 — AI parrots the customer before asking for email

Last AI reply:

> "I'd love to share the details of our monthly, quarterly, and annual packages, as well as our personal training options! First, could you please share your email address…"

This is the lead-capture HARD GATE doing its job (name+email required before any plan info), but the prompt does not tell the model **how** to ask — so Gemini echoes the customer's question back almost verbatim before pivoting to the ask. Reads like the AI didn't listen.

**Fix (prompt-only, no logic change):** in `_shared/ai-agent-brain.ts` lead-capture block (~line 273), add:

```
STYLE RULES (apply to every gated reply):
- NEVER restate, paraphrase, or list back what the user just asked for.
- NEVER promise "I'll share the details" before name+email are captured.
- Acknowledge in ≤6 words ("Sure!" / "Happy to help, ") then ask the ONE missing field.
- Keep gated replies under 25 words. One sentence. No bullet lists. No emoji storm.
```

Add 2 few-shot examples (good vs bad) so the model anchors on the brief style.

No change to the gate itself, no change to lead-capture flow, no change to the email regex.

## Files touched

- `src/pages/WhatsAppChat.tsx` — header sub-line + chat-row preview (IG/MSG branch)
- `supabase/functions/meta-webhook/index.ts` — don't cache empty profile, extra diag log
- `supabase/functions/meta-admin/index.ts` — add `refresh_ig_profile` action (single IGSID)
- `src/pages/WhatsAppChat.tsx` — `⋯` menu item "Refresh Instagram profile"
- `supabase/functions/_shared/ai-agent-brain.ts` — STYLE RULES + 2 examples in gated block
- One-off backfill call (no migration)

## Memory update

Append to `mem://integrations/whatsapp-crm-system-v25-0` (or the IG memory file):
- IG/MSG threads store **IGSID/PSID in `phone_number`** — UI must never render it as a phone.
- `resolveInstagramSenderProfile` must NOT cache empty results; retry on next inbound.
- "Refresh Instagram profile" header action exists for anonymous IG threads.
- AI gated replies must follow the STYLE RULES (no parroting, ≤25 words, one ask).

## Out of scope

- Schema change to split `phone_number` into `external_id` (large refactor, separate task).
- Re-architecting the email gate itself (still a sensible rule for lead-capture).
- IG comment-to-DM flow (already moved to Automation Brain last loop).
