# Stop the WhatsApp / IG bot from leaking the July 2026 opening date

## Problem
The bot told Madhav "we are aiming to open our doors in July 2026." We never publicly committed an opening date in customer comms — the date only lives in our SEO knowledge files (`public/llms-full.txt`, `public/llms.txt`, `public/ai.txt`) and in `ai_knowledge` rows seeded by old migrations. The brain pulls from `ai_knowledge` via RAG, so the model happily repeats it.

Per your decision: **keep the date on SEO files** (search engines + LLM crawlers still cite it), **block it everywhere the bot can speak**.

## Scope (what changes)
1. **`ai_knowledge` rows** — rewrite every row containing "July 2026" / "opens" / "launch date" to use the phrase **"opening date to be announced"**. Affected rows (confirmed via DB):
   - `facts` → "Incline Fitness — canonical facts" (lines mentioning "July 2026")
   - `behavior_rules` → "Answer-first behavior" (opening-timeline line)
   - `identity_rules` → "Member-first identity rule" (Timeline Reality)
   - `lead_capture_flow` → "Founder's Phase Onboarding Sequence"
   - `pricing_rules` → "Pricing Embargo & Founder's Reservation Protocol"
   - `pt_rules` → "Personal Training — Velvet Rope"
   - `persona` → "Ananya — Member Concierge"
   - Replacement copy: "Opening date has not been announced yet — say only 'opening date to be announced' or 'launching soon'. NEVER quote a month or year."
   - Done via one migration that does targeted `regexp_replace` on `content` and bumps `updated_at` so embeddings re-queue (existing `tg_ai_knowledge_enqueue_embed` trigger fires on update).

2. **`supabase/functions/_shared/ai-agent-brain.ts` — sanitizer hardening (v3.6.0)**
   - Extend `sanitizeFoundersPhaseText` to detect & strip any month-year opening claim:
     - Regex: `/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s*,?\s*20\d{2}\b/gi`
     - Also: `/\b(?:opens?|opening|launch(?:es|ing)?|doors?\s+open)\s+(?:on|in|by)?\s*(?:[a-z]+\s+)?20\d{2}\b/gi`
     - Also: bare year alone in opening context, e.g. `/\b(?:open|launch)[^.]{0,40}\b20\d{2}\b/gi`
   - When matched, replace the offending sentence with: *"Our opening date hasn't been announced publicly yet — our team will share it as soon as it's locked in ✨"*
   - Add a console.log tag `[AI:guards] redacted opening-date leak` for observability.
   - Update file-top changelog comment from "Opening date corrected to July 2026" → "Opening date never disclosed by bot (v3.6.0)".

3. **Hard-coded leak in `ai-agent-brain.ts:160`** — the `timeline:` fallback string literally says *"We open on June 22nd — Founding Members get launch-day perks ✨"*. Replace with *"Opening date will be announced to Founding Members first ✨"*.

4. **Deploy** `ai-agent-brain` shared module is pulled by `ai-agent-brain` edge fn (and any caller). Redeploy: `ai-agent-brain` only (consumers re-bundle).

5. **Memory update** — `mem://index.md` Core line currently says *"Founder's Phase (pre July-2026 launch)"*. Rewrite to *"Founder's Phase (pre-launch — opening date NOT disclosed by AI; SEO files only)"* so future agents don't reintroduce the leak.

## Out of scope (intentionally untouched)
- `public/llms-full.txt`, `public/llms.txt`, `public/ai.txt`, `public/sitemap.xml` — your SEO/AEO truth, stays as-is.
- Old SQL migration files (immutable history).
- `public-self-onboarding` / member-facing UI strings — none of these speak dates.

## Verification
1. After deploy, send the same WhatsApp probe: *"On 1 of July the gym open?"* → bot should respond without confirming any date.
2. Probe variants: *"Kab open ho rahe ho?"*, *"When do you launch?"*, *"July 2026 mein khulega?"* → all redacted.
3. Inspect `error_logs` / function logs for `[AI:guards] redacted opening-date leak` to confirm sanitizer fires.
4. Re-check Madhav's thread — bot will no longer cite a date in future replies.

## Files touched
- `supabase/migrations/<new>_redact_opening_date_from_ai_knowledge.sql` (new)
- `supabase/functions/_shared/ai-agent-brain.ts` (sanitizer + timeline literal)
- `mem://index.md` (Core line)

No schema, RLS, or grants change.
