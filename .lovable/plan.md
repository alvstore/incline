
## Goal
Stop the AI concierge from re-asking name/phone for anyone we already know, on any channel, and block duplicate lead creation — by reusing the **existing** Pre-Fetch Injection pipeline (no new files).

## Current state (confirmed by scan)
The pattern the user is asking for is **already implemented**, but with two gaps:

- `supabase/functions/_shared/ai-agent-brain.ts` already calls `resolveMemberContext(senderId, branchId, platform)` before the LLM (line 284), builds an `identity` object (lines 443-468), and passes it to `buildSystemPrompt({ identity, ... })`.
- `supabase/functions/_shared/ai-prompt.ts` already renders `<user_context role="member|lead|unknown">` (lines 184-208) and a matching `<role_objective>` into the system prompt.
- `leads.phone` is indexed (`idx_leads_phone`, two partial uniques). Lookup latency is well under 50ms.
- Duplicate-lead protection already exists in `captureLeadAndNotify` (lines 1629-1717): variant-aware phone + email dedupe before insert.

## Gaps to fix

1. **IG / Messenger identity is lost.** `resolveMemberContext` does `phoneVariants(senderId)`, but on IG/Messenger `senderId` is an IGSID (numeric), not a phone — so even leads we **already captured on website/WhatsApp** show as `unknown` when they later DM on Instagram. We do hydrate `whatsapp_chat_settings.captured_lead_id` for WhatsApp (`hydrateBrainFromExistingLead`), but `resolveMemberContext` never reads it back.
2. **`<user_context>` lacks phone + email.** User explicitly asked for "Name, Phone, Stage". Today the block only has name, lead_id, funnel_stage, branch.
3. **Lead branch doesn't explicitly tell the LLM "Execute lead capture"** for `unknown`. The role_objective implies it, but a one-liner cue prevents the LLM from re-asking known facts during the deterministic backfill ladder.

## Changes (4 spots, 2 existing files only)

### A. `supabase/functions/_shared/ai-agent-brain.ts` — extend `resolveMemberContext` (lines 1394-1450)
- Step 1 (unchanged): try `phoneVariants(senderId)` against `profiles.phone` then `leads.phone`.
- **New Step 1b**: if no phone match AND `platform !== 'whatsapp'`, look up `whatsapp_chat_settings` by `(branch_id, phone_number=senderId)` and read `captured_lead_id`. If present, fetch that lead row (id, full_name, phone, email, status, fitness_goal) and return as `leadId/leadName/leadStage/leadPhone/leadEmail`.
- **New Step 1c**: if still nothing, query `ai_memory` for `(branch_id, platform, contact_key=senderId)` and pull `profile.phone` / `profile.email`. If a phone is present, run one more variant lookup on `leads` and `profiles` — this auto-links the next time the same person messages us anywhere.
- Single round-trip per step, all bounded `.limit(1).maybeSingle()`. Budget ≤ 60ms (3 indexed lookups; we already do 2).

### B. `supabase/functions/_shared/ai-agent-brain.ts` — extend the `identity` payload (lines 443-468)
Add `phone` and `email` to both the `member` and `lead` branches (the prompt assembler already accepts an `Identity` record). Source from `memberCtx.leadPhone/leadEmail` (new fields) or the resolved profile.

### C. `supabase/functions/_shared/ai-prompt.ts` — extend `<user_context>` (lines 184-208) and `Identity` type
Add `phone` and `email` lines for member + lead. For unknown, append the explicit cue:
```
<user_context role="unknown">
- channel_id: ${id.senderId}
- branch: ${id.branchName ?? "(default)"}
- directive: Execute lead capture — ask for name → email → fitness goal → plan interest (deterministic order).
</user_context>
```
For member/lead, append:
```
- IMPORTANT: name, phone and email above are already known. Never re-ask. Use them in greetings and when calling tools.
```

### D. `MemberResolveResult` type (line 119 region) — add optional `leadPhone`, `leadEmail`, `memberPhone`, `memberEmail` so TypeScript stays clean.

## Out of scope (intentionally)
- No new files. No edge function changes outside the two listed.
- No DB migration — existing indexes (`idx_leads_phone`, `profiles.phone` lookups via PK-joined IDs) are sufficient.
- No change to `captureLeadAndNotify` dedupe — already correct.
- No change to `meta-webhook` / `whatsapp-webhook` entry points — they already call the AI brain which calls `resolveMemberContext`.
- No JSON envelopes leak to chat (already fixed in v5.7.0 via `chatEnvelope.ts`).

## Verification
1. `supabase--curl_edge_functions` against `meta-webhook` simulating an Instagram DM from a phone-captured lead → confirm `<user_context role="lead">` block now includes Name + Phone + Stage and AI greets by name without asking phone.
2. Re-run Hitangi's flow on WhatsApp → confirm no regression (still member/lead routed correctly).
3. `psql` spot-check: `SELECT count(*) FROM leads WHERE phone IS NOT NULL AND created_at > now() - interval '1 day' GROUP BY phone HAVING count(*) > 1;` → expect 0.

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` (resolveMemberContext + identity build + type)
- `supabase/functions/_shared/ai-prompt.ts` (Identity type + renderUserContext)
