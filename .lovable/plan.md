## Confirmed
- **11,000 sq ft** facility
- Opening: **July 2026** (no exact day published)

## Status

✅ **Knowledge base updated** (data migration applied) — three `ai_knowledge` rows reconciled:
- `persona` (Ananya) → 11,000 sq ft, pre-opening Founder's Phase, explicit "you do NOT know plan names / durations / PT packages / prices", greeting-discipline clause added.
- `facts` → 11,000 sq ft, "July 2026" only (no day), removed any hint of class/PT specifics.
- `behavior_rules` → Velvet Rope expanded to cover plans + plan durations + PT package names + PT session counts (not just prices); founding-member waitlist is the only CTA; greeting-discipline rule added.

⏳ **Code patch — awaiting build mode**

Add a `looksLikeRealName(name)` helper to `supabase/functions/_shared/ai-agent-brain.ts` (v3.3.0) and guard 2 greeting sites so the brain never addresses a user as "Sample" / "Test" / a phone number / emoji-only handle:

- Reject as fake:
  - blocklist: `sample, test, testing, user, demo, customer, unknown, na, none, null, n/a, admin, guest`
  - pure digits / `^\+?\d[\d\s-]{5,}$`
  - <2 or >40 chars
  - >50% non-letter characters
  - equal to the sender's phone number
- Apply at:
  - `askNextMissing()` (line ~573–578) — gate the `firstName` greeting.
  - `buildRuntimeRules()` (line ~1301–1303) — skip emitting `KNOWN NAME: Greet/address user as "X"` when the stored name fails the guard, and instead emit `NAME UNVERIFIED: Greet generically; ask for the user's real name as the first onboarding step.`

No other call sites change (`partialData.contact_name` at L940 and the audit field at L1076 keep the raw WA profile name — only the *greeting/system-prompt* path is gated).

## Verification (after build-mode patch)
1. WA test from a number whose profile name is `Sample` → expect: generic "Hi there!" + ask for real name. No "Hi Sample".
2. Ask "what are your plans?" → expect Velvet Rope reply, no plan tier names, no prices, no PT packages.
3. Ask "when do you open?" → expect "July 2026" (no day).

## To proceed
Switch to build mode and I'll apply the `ai-agent-brain.ts` patch in one edit.