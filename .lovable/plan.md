
# Epic Sprint: Centralized AI Memory + Public Launch Date (26 July 2026)

## Public date is now official: Sunday, 26 July 2026

All embargoes on the *date itself* are lifted. The **pricing embargo remains** — plans/fees stay under wraps until the opening. Every source of truth (SEO files, `ai_knowledge`, sanitizer, canned regex answers) is aligned to a **single** date string.

## Canonical strings (SSOT — use these exact values everywhere)

- **Opening date:** `Sunday, 26 July 2026`
- **Short form:** `26 July 2026`
- **Embargo pivot line (English):** `"We open on Sunday, 26 July 2026. All plan pricing is under embargo until then — right now I can only reserve your Founding Membership spot. Want me to add your name?"`
- **Embargo pivot line (Hinglish):** `"Hum Sunday, 26 July 2026 ko launch kar rahe hain. Tab tak saare plans embargo mein hain — abhi main sirf Founding Membership spot reserve kar sakta hoon. Naam add kar doon?"`

## Current fragmentation (audit)

| Layer | File(s) | Today's state |
|---|---|---|
| SEO | `public/llms.txt`, `public/llms-full.txt`, `public/ai.txt`, `index.html` (JSON-LD), `public/sitemap.xml` | `llms*` currently show `"n"` placeholder (previously scrubbed). `index.html` has no `openingDate`. |
| Knowledge base SSOT | `ai_knowledge` rows `facts`, `pricing_rules`, `pt_rules` (migration `20260610131829…`) | Say `"July 2026"` (no day). `pricing_rules` and inline scaffolds contradict each other. |
| Brain regex canned answers | `ai-agent-brain.ts` `INTENT_ANSWERS.timeline` / `.pricing` (lines 229–233) | Say *"date hasn't been announced"* — stale, conflicts with new public date. |
| Inline duplicated prose | `ai-agent-brain.ts` lines 1094–1100, 1119, 1503, 1590–1598, 1687–1721 | 6+ copies of "Founding Member (Annual) is our only active enrollment" — the exact "memory conflict" the user reported. |
| Sanitizer | `ai-agent-brain.ts` lines 1611–1625 (`redactOpeningDate`) | Strips *every* `<month> 20XX` — will now wrongly redact "26 July 2026" from legitimate replies. |

## Epic 1 — Purge duplicates, single SSOT

### 1a. `ai-agent-brain.ts` — introduce shared constants, delete duplicated prose

```ts
// Single source of truth for user-facing embargo copy. Every regex-fallback
// canned answer and every inline prompt scaffold reads from here.
export const LAUNCH_DATE_LABEL = "Sunday, 26 July 2026";
export const EMBARGO_PIVOT_LINE_EN =
  `We open on ${LAUNCH_DATE_LABEL}. All plan pricing is under embargo until then — ` +
  `right now I can only reserve your Founding Membership spot. Want me to add your name?`;
export const EMBARGO_PIVOT_LINE_HI =
  `Hum ${LAUNCH_DATE_LABEL} ko launch kar rahe hain. Tab tak saare plans embargo mein hain — ` +
  `abhi main sirf Founding Membership spot reserve kar sakta hoon. Naam add kar doon?`;
```

Replace:
- `INTENT_ANSWERS.pricing` → `EMBARGO_PIVOT_LINE_EN`
- `INTENT_ANSWERS.timeline` → `EMBARGO_PIVOT_LINE_EN` (timeline no longer says "not announced")
- `OPENING_DATE_NEUTRAL` (line 1616) → `EMBARGO_PIVOT_LINE_EN`
- Inline "Founding Member (Annual) is our only active enrollment…" prose at lines 1094–1100 → single reference to `EMBARGO_PIVOT_LINE_EN`
- POST-CAPTURE NURTURE block (line 1119) → replace 6-line embargo prose with: `Refer to the "Launch & Pricing Embargo" rule in <knowledge_base>. Never paraphrase.`
- `askNextMissing` closer (line 1511) and `enforceNoRepeatNameAsk` closer (line 1598) → `EMBARGO_PIVOT_LINE_EN` (personalized with `firstName` when known)

### 1b. Sanitizer fix — allow the canonical date through

`OPENING_DATE_RE` and `OPENING_VERB_YEAR_RE` currently strip **any** `<month> 20XX`. Update them so a message containing the exact canonical string `"26 July 2026"` or `"Sunday, 26 July 2026"` passes through unchanged; all other year-bearing month phrases (LLM hallucinations, wrong months) are still redacted to `EMBARGO_PIVOT_LINE_EN`.

Implementation: bail out of redaction with a preflight check `if (/\bSunday,?\s+26\s+July\s+2026\b|\b26\s+July\s+2026\b/i.test(text)) return { redacted: text, hit: false };`.

## Epic 2 — Knowledge base alignment (single migration)

New migration `<timestamp>_launch_date_and_embargo_ssot.sql`:

**`ai_knowledge` upserts** (all `priority=1`, `applies_to={all}`, `is_active=true`, `status='active'`):

1. **`launch_timeline` / "Public Opening Date"** — content:
   > Incline opens to the public on **Sunday, 26 July 2026**. This date is now public — quote it accurately. Do NOT invent a time of day or day-1 schedule.

2. **`pricing_rules` / "Launch & Pricing Embargo"** — content (verbatim, this is the unified rule the user asked for):
   > **[LAUNCH & PRICING EMBARGO RULE]** — Incline opens on Sunday, 26 July 2026. You are strictly forbidden from quoting any prices, fees, or membership tiers before that date. All plan details will be exclusively disclosed on and after the July 26 opening. If asked about pricing, fees, or timeline, you MUST state this embargo and immediately pivot to the ONLY allowed action: asking the user if they want to reserve a spot for a Founding Membership.
   >
   > Approved reply (English): "We open on Sunday, 26 July 2026. All plan pricing is under embargo until then — right now I can only reserve your Founding Membership spot. Want me to add your name?"
   >
   > Approved reply (Hinglish): "Hum Sunday, 26 July 2026 ko launch kar rahe hain. Tab tak saare plans embargo mein hain — abhi main sirf Founding Membership spot reserve kar sakta hoon. Naam add kar doon?"
   >
   > Never write a currency symbol (₹, Rs., INR) or a number followed by /month, /mo, per month. Never list plan tiers by name with prices.

3. **`facts` refresh** — update `source_data.opening_label` from `'July 2026'` → `'Sunday, 26 July 2026'`; scrub the `"say July 2026 only"` clause.

4. **`pt_rules` refresh** — replace `"Until the official launch (July 2026)"` → `"Until the official launch on 26 July 2026"`.

## Epic 3 — SEO / crawler surfaces

**`public/llms.txt`** — replace `Opening: n` → `Opening: Sunday, 26 July 2026`.

**`public/llms-full.txt`** — replace `Opens to public: **n**` → `Opens to public: **Sunday, 26 July 2026**`; replace `before the n public opening` → `before the 26 July 2026 public opening`; add `Q: When does Incline open?` / `A: Sunday, 26 July 2026.` to the Q&A block.

**`public/ai.txt`** — add `opening-date: 2026-07-26` line if not present.

**`index.html`** — extend the existing `HealthClub` / `Organization` JSON-LD with `"openingDate": "2026-07-26"` and refine `"description"` to include the date. Keep title/canonical/og:* unchanged (they're already correct).

**`public/sitemap.xml`** — no URL changes; just bump `<lastmod>` on `/` and `/register` to today.

**Memory core rule** — update `mem://index.md` Founder's Phase line from *"opening date NOT disclosed by AI"* to *"opening date is public: Sunday, 26 July 2026 — pricing still embargoed until then"*.

## Files touched

- `supabase/migrations/<new>_launch_date_and_embargo_ssot.sql` (new)
- `supabase/functions/_shared/ai-agent-brain.ts` (constants + delete 6 duplicated prose blocks + sanitizer bypass)
- `public/llms.txt`, `public/llms-full.txt`, `public/ai.txt`, `index.html`, `public/sitemap.xml`
- Memory: update `mem://index.md` Founder's Phase core rule + core embargo rule

No changes to `ai-prompt.ts`, `ai-memory.ts`, `ai-dynamic-memory.ts`, `ai-runtime.ts` — architecture is already correct, only content was fragmented.

## Verification

- `rg -n "Founding Member \(Annual\) is our only active enrollment" supabase/functions/_shared/ai-agent-brain.ts` → 0 hits post-edit.
- `rg -n "July 2026|\"n\"" supabase/functions/_shared/ public/llms.txt public/llms-full.txt public/ai.txt` → every remaining hit is intentional (`26 July 2026`).
- Manual: send "kitna hai?" and "kab khulega?" to the brain → both return `EMBARGO_PIVOT_LINE_EN` verbatim (regex path) and the LLM path returns the same wording from `<knowledge_base>` (Epic 2 row).
- Sanitizer unit check: `redactOpeningDate("We open on Sunday, 26 July 2026 ✨")` returns `hit=false`.
- SEO scan (Rescan button) confirms `openingDate` present in JSON-LD.
