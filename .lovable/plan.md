## Problem

Catalog rows (Plans, PT packages, Facilities, Branches) keep re-appearing in **AI Brain → Knowledge** after you delete them, and all 13 of them show "Embed failed".

**Root cause (confirmed):**
- Automation rule `sync_ai_knowledge` runs **every hour** (`cron 0 * * * *`) and calls the `sync-ai-knowledge` edge function, which upserts those rows back using a stable `source_ref`.
- Their content is intentionally stripped of prices / session counts (Founder's Phase rule), so they add noise but no usable info — and they fail to embed reliably, hurting retrieval quality for the rows that *do* matter (persona, rules, canonical facts).

**Why removing them is safe:**
- The 8 hand-authored rows (Ananya persona, identity rules, anti-parrot, grounding, reply shape, formatting, canonical facts, answer-first) already cover everything the AI is *allowed* to say during Founder's Phase.
- Plans / PT / facilities / branches data is still queryable by AI tools at runtime when needed — it does not need to live in the RAG corpus.

## Changes

1. **Disable the automation rule** `sync_ai_knowledge` (set `is_active = false`) so it stops re-seeding hourly. Keep the row so it can be re-enabled later if Founder's Phase ends.
2. **Delete the 13 existing catalog rows** from `ai_knowledge` (those with `source_ref` starting with `plan:`, `pt:`, `facility:`, `branch:`).
3. **Leave the `sync-ai-knowledge` edge function in place** but unused — it's the future-ready path for when you *do* want pricing/sessions in the brain (post-launch). No code deleted.
4. **Tighten the UI:** in `AIBrainTab.tsx`, hide the "Embed failed" badge when a row's `source_ref` indicates it's a sync-seeded row that has been disabled — only shown if the sync rule is currently active. (Cosmetic; prevents the misleading red badge from coming back if someone re-enables the rule later.)

## Out of scope

- Not touching the persona / rules / facts rows.
- Not changing the sync function itself — its content rules (no prices, no session counts) are already correct per Founder's Phase. We just don't want it running yet.
- Not changing the embed-knowledge function or model — that's a separate investigation if you decide to re-enable sync later.

## Verification

After applying:
- Knowledge tab shows only the 8 hand-authored rows, all green ("Ready").
- `automation_rules` row for `sync_ai_knowledge` shows `is_active = false`; `last_run_at` stops advancing.
- Send a test WhatsApp like "what plans do you have?" — AI should reply per Founder's Phase script (capture interest, don't quote prices) using the canonical facts row, no change in behaviour.

## Technical details

- Migration:
  - `UPDATE automation_rules SET is_active = false WHERE key = 'sync_ai_knowledge';`
  - `DELETE FROM ai_knowledge WHERE source_ref ~ '^(plan|pt|facility|branch):';`
- UI file edited: `src/components/settings/AIBrainTab.tsx` (badge guard only).
- No edge function deploys, no schema change, no embed model change.
