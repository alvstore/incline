
## Problem (audit finding)

Bhavyadeep Kingrani (`+91 63775 36196`) submitted the **website form at 11:05:45 UTC**. `webhook-lead-capture` created `leads` row `a91dad34…` with `full_name="Bhavyadeep Kingrani"`, `phone=+916377536196`, `source=website`, `status=new`.

**16 seconds later** he messaged WhatsApp:
> "Hi, I'd like to know more about Incline Fitness Founding memberships."

If the AI brain were to reply (after the master switch fix from the previous turn), it would have started the founder's-phase onboarding from Turn 1 — "Hi there! What's your name?" — because the brain only hydrates `ai_memory` (empty for a fresh contact) and **never reads the `leads` table**. The "KNOWN SO FAR" block in the prompt would show all `—`, so the ADVANCE RULE picks the first missing field = name.

Evidence in `supabase/functions/_shared/ai-agent-brain.ts`:
- Line 274 calls `resolveMemberContext` (members only).
- Line 279 calls `loadMemory(ai_memory)` — empty for new WhatsApp contacts.
- Lines 506–509 render KNOWN SO FAR purely from `memory.profile` / `memory.facts`.
- The dedupe-on-write logic at line 1372 only fires **after** the AI emits `lead_captured` JSON — too late; the user has already been re-asked everything.

Also, when a lead is fully captured (all 4 fields), the brain has no "post-capture nurture" persona — it stays in onboarding mode forever for the same contact across days.

## Plan

### Step 1 — Add `resolveLeadContext` lookup (server, ai-agent-brain.ts)

Right after `resolveMemberContext` (line 274), add:

```ts
const leadCtx = !memberCtx.isMember
  ? await resolveLeadContext(supabase, ctx.senderId, ctx.branchId)
  : null;
```

`resolveLeadContext` (new helper in `_shared/ai-memory.ts` or inline):
- Uses `phoneVariants(senderId)` already imported.
- `SELECT id, full_name, email, fitness_goal, goals, plan_interest, source, status, expected_start_date, fitness_experience, preferred_time, created_at FROM leads WHERE phone IN (variants) AND branch_id = ctx.branchId ORDER BY created_at DESC LIMIT 1`.
- Returns `{ leadId, profile, facts, capturedAt, source } | null`.

### Step 2 — Seed `ai_memory` from existing lead BEFORE the auto-learn pass

After `loadMemory` (line 279), if `leadCtx` exists AND `memory` lacks those keys:

```ts
if (leadCtx) {
  await upsertMemory(supabase, ctx.branchId, ctx.platform, ctx.senderId, {
    profile: {
      full_name: leadCtx.profile.full_name ?? undefined,
      first_name: firstNameOf(leadCtx.profile.full_name),
      email: leadCtx.profile.email ?? undefined,
    },
    facts: {
      fitness_goal: leadCtx.facts.fitness_goal ?? undefined,
      plan_interest: leadCtx.facts.plan_interest ?? undefined,
      lead_source: leadCtx.source,
      lead_captured_at: leadCtx.capturedAt,
    },
    do_not_ask_add: [
      ...(leadCtx.profile.full_name ? ["name", "full_name"] : []),
      ...(leadCtx.profile.email ? ["email"] : []),
      ...(leadCtx.facts.fitness_goal ? ["goal", "fitness_goal"] : []),
      ...(leadCtx.facts.plan_interest ? ["plan_interest"] : []),
    ],
  });
  memory = await loadMemory(...);
}
```

This makes the existing "KNOWN SO FAR" + ADVANCE RULE block (lines 505–510) work correctly: for Bhavyadeep, `name=Bhavyadeep Kingrani`, others `—`, so Turn 1 reply becomes *"Hi Bhavyadeep! What's the best email for your Founding Member invite? ✨"* — skipping the redundant name ask.

Also writes `whatsapp_chat_settings.captured_lead_id = leadCtx.leadId` if not already set, so the existing lead is linked to the chat from message one.

### Step 3 — Add "post-capture nurture" persona branch

In the prompt section starting at line 429, split into three states based on `leadCtx` + filled fields:

| State | Trigger | Behavior |
|---|---|---|
| **Fresh** | No `leadCtx`, no `ai_memory` profile | Existing onboarding flow (Turn 1 → Turn 5). |
| **Partial** | `leadCtx` exists OR memory has some fields | Skip filled fields, jump to first missing one. (Already works once Step 2 seeds memory.) |
| **Captured** | All 4 fields filled (name, email, goal, plan_interest) — OR `leadCtx.status` is not `'new'` | Switch to **post-capture nurture** persona: warm conversational replies, answer fitness/founding-member questions, push Founding Member confirmation CTA, never re-ask onboarding fields, never emit `lead_captured` JSON again. |

New short prompt block for the Captured state:

```
POST-CAPTURE NURTURE MODE (lead already in CRM):
- This contact is already a captured lead (since {{lead_captured_at}}, source: {{lead_source}}).
- DO NOT run onboarding. DO NOT ask name/email/goal/plan again. DO NOT emit lead_captured JSON.
- Greet warmly by first name and answer their question directly.
- For Founding Member questions: confirm interest and offer to lock in their spot ("Want our team to call you to confirm your Founding spot?").
- For non-annual interest already on file: acknowledge, no hard push.
- Velvet rope still applies: no ₹, no PT names, no session counts.
- If they ask to speak to a human → call transfer_to_human.
```

### Step 4 — Suppress duplicate `notify-lead-created` + nurture cron for already-captured leads

In `lead-nurture-followup` (cron) and `notify-lead-created`:
- Skip rows where `source IN ('whatsapp_ai','instagram_ai','messenger_ai')` AND a prior lead with same phone+branch already had nurture sent. (Use an existing flag like `last_contacted_at` + a new `nurture_sent_at` column on `leads` — add via migration only if not present; otherwise reuse `last_contacted_at IS NOT NULL`.)
- For the AI brain's `tryParseAndCaptureLead` merge branch (line 1380), set `nurture_sent_at = COALESCE(nurture_sent_at, now())` so a website-captured-then-WhatsApp-merged lead doesn't trigger nurture again.

(If `nurture_sent_at` does not exist yet, this becomes a tiny migration: `ALTER TABLE leads ADD COLUMN nurture_sent_at timestamptz`.)

### Step 5 — Backfill Bhavyadeep

One-off: send him the founder's-phase opening template ("Hi Bhavyadeep, thanks for reaching out about Founding Memberships — what's the best email for your Founding Member invite?") from the inbox so the lead row gets `email`, then the nurture sequence proceeds naturally.

## Out of scope

- No changes to `webhook-lead-capture` or `capture-lead` (they already dedupe by phone+branch).
- No changes to the master AI switch logic (already fixed in the previous turn).
- No schema changes beyond the optional `nurture_sent_at` column in Step 4.
- No changes to the existing `tryParseAndCaptureLead` merge-by-phone branch — it stays as defense in depth.

## Files to touch

- `supabase/functions/_shared/ai-agent-brain.ts` — add `resolveLeadContext` call, seed memory, add Captured persona branch (~60 lines).
- `supabase/functions/_shared/ai-memory.ts` — add `resolveLeadContext` helper (~30 lines).
- `supabase/functions/lead-nurture-followup/index.ts` — add `nurture_sent_at IS NULL` filter (~3 lines).
- `supabase/functions/notify-lead-created/index.ts` — skip if `last_contacted_at` recent or `nurture_sent_at` present (~5 lines).
- *(Optional)* migration adding `leads.nurture_sent_at timestamptz`.

## Validation

1. Reset Bhavyadeep's `ai_memory` row (so we can replay).
2. Simulate inbound WhatsApp "Hi, I'd like to know more about Founding memberships." via `whatsapp-webhook` test payload.
3. Assert first AI reply starts with "Hi Bhavyadeep" and asks for **email** (not name).
4. Assert no duplicate `leads` row created.
5. Assert `whatsapp_chat_settings.captured_lead_id` is linked.
6. Send "rohan@gmail.com" → assert next ask is **goal** (interactive_list), not name/email.
