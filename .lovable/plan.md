## Audit findings

### 1. Prefix leak: `Share full address: Sector 14, Udaipur, Rajasthan.`
The v4.6.0 sanitizer only strips the pattern `<location|pricing|timeline|opening|launch|intent> intent —/:`.
A newer admin row in `ai_dynamic_memory` uses an **imperative-style** prefix:

```
id: a395258e-…  intent_category=location
correction_instruction: "Share full address: Sector 14, Udaipur, Rajasthan."
```

That whole string was emitted verbatim to the user. There are 10 curated rows total; several still leak `Location intent —` / `Pricing intent —` because they're being saved by admins as internal notes, not user-facing copy.

### 2. Multi-intent question dropped half the answer
User asked: *"When it is opening and address"* — brain pivoted with location only and ignored the opening half. Single-intent classifier picks the first match (location) and exits. Founder's-phase rule still applies (opening date embargoed), so the right answer is: location line + "Our opening date hasn't been announced publicly yet — Founding Members will be the first to know."

### 3. Funnel didn't acknowledge "U are opening at sector 14"
After the user confirmed location, the bot jumped straight to the goal CTA. It should briefly acknowledge ("Yes — Sector 14, Udaipur ✨") before progressing.

### 4. Nurture audit
- `automation_rules.lead_nurture_followup` is **active**, cron `*/15 * * * *`, last_run = success 7 min ago, dispatched 1.
- 81 active chats, **53 never nurtured**, 13 nurtured in 24h.
- Root cause for the 53: `lead-nurture-followup/index.ts:329` — `if (lead?.id) continue;` **skips any chat that already has a `leads` row**. Since `capture-lead` creates a lead on first inbound, almost every prospect is excluded. This inverts the documented intent (nurture is supposed to chase leads who went cold). Member-link skip on line 335 is correct and stays.
- Secondary: chats with `bot_active=false` (manual handoff / "AI paused 365d") are excluded by design — correct, no change.

---

## Plan

### A. Brain sanitizer — `supabase/functions/_shared/ai-agent-brain.ts`
1. Add a second regex `INTENT_INSTRUCTION_PREFIX_RE` that strips any imperative-with-colon opener:
   `^\s*(share|tell|reply|say|mention|use|send|give|provide|inform|respond|answer|state)[^:\n]{0,80}:\s*`
2. In `intentPivotPrefix()`, apply both regexes (existing + new) before the residual-check; if cleaned text still starts with an imperative verb followed by a colon, fall back to the canonical `INTENT_ANSWERS[cat]`.
3. Add unit-style log `[AI:guards] stripped instruction-prefix`.
4. **Multi-intent**: extend classifier to return `Set<HinglishIntent>` when more than one match is found, and concatenate canonical answers in priority order (location → timeline → pricing), space-separated, before the funnel response. Cap to 2 intents to keep it tight.
5. Add a tiny ack-prefix when the prior user message is a confirmation of bot-stated location ("u are opening at sector 14" / "ok sector 14"): respond with `Yes — Sector 14, Udaipur ✨ ` before continuing the funnel.

### B. Backfill curated memory — new migration
- Update all 10 `ai_dynamic_memory` rows in `(location | pricing | timeline)` so `correction_instruction` is the **user-facing answer**, not the admin note:
  - location → `We're at Sector 14, Udaipur, Rajasthan ✨`
  - pricing  → `Founding Member (Annual) is our only active enrollment right now — full pricing is shared by our team once you're on the Founder's list ✨`
  - timeline → `Our opening date hasn't been announced publicly yet — Founding Members will be the first to know ✨`
- Add a CHECK-style trigger `tg_ai_dynamic_memory_sanitize` that rewrites any new insert/update whose text starts with `^(<cat>\s+intent\s*[—\-:])` or the imperative pattern above, into the canonical answer. Prevents future leaks at the source.

### C. Nurture fix — `supabase/functions/lead-nurture-followup/index.ts`
1. Remove the blanket skip on line 329 (`if (lead?.id) continue;`). Nurture should fire **for cold leads**, not skip them. Keep the member-link skip (line 335) — converted members should not be nurtured.
2. Add a stronger qualifier: only nurture if `leads.status IN ('new','contacted','no_response')` (skip `qualified`, `converted`, `lost`, `do_not_contact`).
3. Add a log line per skip reason so future audits don't need code-reading.
4. Add a `nurture_audit` JSONB column-free summary returned in the function response (counts of `skipped_member`, `skipped_status`, `skipped_window`, `skipped_gap`, `nudged`) — surfaces in `automation_rules.last_error` / `last_dispatched_count`.

### D. Verification
- After deploy, hit `/lead-nurture-followup` once via curl and inspect the JSON summary.
- Re-run the WhatsApp test: send `When it is opening and address` and `U are opening at sector 14` from a sandbox number; confirm:
  - No `Share full address:` / `Location intent —` leak.
  - Both opening + address handled in one reply.
  - Funnel ack appears.
- SQL spot-check on `ai_dynamic_memory` shows zero rows with admin-note prefixes.

### Files changed
- `supabase/functions/_shared/ai-agent-brain.ts` (sanitizer + multi-intent + ack)
- `supabase/functions/lead-nurture-followup/index.ts` (skip rules + audit summary)
- new migration: backfill + sanitize trigger on `ai_dynamic_memory`
- redeploy: `whatsapp-webhook`, `meta-webhook`, `lead-nurture-followup`

### Out of scope
- Changing public SEO files (still say "July 2026" for crawlers — Founder's-Phase rule unchanged).
- RCS work from previous task.
- Touching cron schedule or `bot_active` semantics.
