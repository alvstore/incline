# Google review replies: why the AI draft is missing, and the fix

## What I found (verified live this session)

**1. Newly fetched reviews are never sent to the AI — this is the main bug.**
Reviews currently arrive through the Places lane (`fetchPlacesReviewsForBranch`). That function upserts the rows and stops. Only the Business Profile lane (`fetchBusinessProfileReviews`, still blocked by Google quota) calls `classifyOne()` on new rows. So every fresh review lands with `ai_classification = 'pending'` and an empty draft, exactly as in your screenshots.

Confirmed in the database: `Sahil Sachdev` and `Rajendra Singh` have `ai_classified_at = null` and no draft; the rows that *do* have drafts were classified only because someone pressed "Re-analyse with AI".

**2. When a draft does exist, the UI can still show an empty box.**
The textarea picks `draft_reply → reply_text → ai_draft_reply`, in that order. `draft_reply` is written on every blur of the textarea — including a blur with empty text. Once that happens, an empty staff draft permanently hides the AI draft.

**3. The reply persona is split across two places and the DB half is stale.**
`ai_purposes.review_reply.system_prompt` still says "thank by name… invite them to email info@theinclinelife.com" (wrong domain) and `max_tokens = 250`, while the real human-tone rules live hardcoded in the edge function and are merely appended. Temperature 0.6 with a fixed rule list is also why the drafts read same-shaped ("Really glad you like…", "Hi X, thank you so much…").

**4. There is no explicit "Draft reply with AI" action.**
"Re-analyse with AI" does classification + drafting in one shot and overwrites whatever is in the box, so staff avoid it. There is no way to ask for another version, a shorter one, or a different tone.

## The fix

### A. Auto-draft every review on arrival
- Call `classifyOne()` for every newly upserted Places review (same best-effort loop and cap the Business Profile lane uses), so a review is never shown without a verdict and a draft.
- Add a small backfill pass: on each fetch, also classify up to N existing rows still stuck at `ai_classification = 'pending'` — this clears Sahil Sachdev and Rajendra Singh on the next sync.

### B. Never lose or hide a draft
- Treat an empty `draft_reply` as "no staff draft": fall back to the AI draft instead of showing a blank box.
- Stop persisting empty drafts on blur, and only overwrite a staff-edited draft when the user explicitly asks for a new one.

### C. Make the replies sound human, not templated
- Move the whole persona into one place (`ai_purposes.review_reply`), rewrite it as the founder's voice, fix the stale contact line, and raise `max_tokens` so the model isn't clipped.
- Reduce sameness: rotate the opening approach, forbid reusing an opener already used in the branch's last few replies (the function already loads recent replies), raise temperature slightly, and keep the banned-phrase list.
- Add anti-boilerplate post-checks: if the draft contains a banned phrase, is over-length, or is near-duplicate of a recent reply, retry once and keep the better one.
- Reply in the reviewer's language register — if the review is Hinglish, reply Hinglish.

### D. Give staff real drafting controls on each review card
- Split the actions: **Draft reply with AI** (writes the draft, keeps the verdict) vs **Re-analyse** (re-runs classification).
- Add lightweight options next to the draft: Regenerate, and tone/length chips (Warm · Short · Apologetic for low ratings).
- Show a clear per-card state while generating, and surface the real error text when the AI call fails instead of leaving the box silently empty.

### E. Prove it
- Trigger a fetch, confirm all `pending` rows get a verdict and a draft.
- Generate three drafts for three different reviews and check openers differ and no banned phrases appear.
- Type a draft, blur, reload — the staff text survives; clear it, and the AI draft reappears.

## Technical notes
- `supabase/functions/google-reviews-brain/index.ts`: classify loop in `fetchPlacesReviewsForBranch`, new `draft_reply` action (draft-only), pending backfill, dedupe/banned-phrase validation in `classifyOne`, error text returned to the client.
- `src/components/feedback/ExternalReviewsTab.tsx`: draft precedence fix, no empty-draft writes, new draft/regenerate/tone controls, per-card loading and error states.
- One data update to `ai_purposes.review_reply` (system prompt, max_tokens, temperature).
- No schema change required.
