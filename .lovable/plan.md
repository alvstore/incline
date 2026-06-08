## Audit findings

Pulled the last 8 nurture outbounds across 4 different leads (Vishal, Rajat, +9001…, +6376…). **Every single one is byte-identical**:

> "Hi {name|there}, following up on your interest in Incline Fitness. Did you know our members love our personal training and recovery zone? Let me know if you have any questions or would like to schedule a tour of our club. ✨"

That string lives hard-coded in `lead-nurture-followup/index.ts` as the fallback after AI generation. Two failure modes are stacking:

1. **AI path silently never runs for off-hours leads.** When the contact is outside Meta's 24 h window, the function switches to the approved `lead_nurture_followup` template path and **skips `generateOnce` entirely** — the hard-coded string becomes the rendered body and the template variables (`popular_feature_1/2`) are also hard-coded ("personal training", "recovery zone"). That is why every off-window send is byte-identical.
2. **No "have I said this before?" guard.** Even when AI generation runs, there is no check against the last N outbounds to this contact, so the model is free to converge on the same phrasing — and with no temperature/angle variation it does.
3. **No angle rotation.** `ai_purposes.ops_config` for `lead_nurture` only stores `enabled/delay/retries/cooldown`. There is no catalogue of angles (value / social-proof / founder-scarcity / curiosity / soft-CTA / question-led) and no per-contact pointer telling the brain "you've already used angles A and C — pick something else."
4. **Vishal got a duplicate** of the same nurture line at 16:30 in the screenshot — `dedupe_key` is built from `nurture_retry_count`, which only increments after a successful insert, so two cron ticks within the same minute can both pass the guard. The dispatcher dedupe key needs to be time-bucketed, not retry-bucketed.
5. **No knowledge grounding.** `ai_knowledge` already holds the rich brand/offer/USP corpus the chat brain uses (`match_ai_knowledge` RPC). The nurture function builds a system prompt via `buildSystemPrompt`, but the **template path bypasses it entirely**, and the freeform path passes an empty `userMessage` context — so the model has nothing fresh to pull from.

## Plan

### 1. New DB table: `lead_nurture_angles` (seeded, editable, no code changes to add angles)
```text
id uuid pk
slug text unique            -- 'value', 'social_proof', 'founder_scarcity',
                            --  'curiosity', 'soft_cta', 'question_led', 'recovery_focus',
                            --  'transformation_story', 'community'
label text
tone text                   -- 'warm', 'playful', 'consultative', 'urgent_soft', 'curious'
prompt_hint text            -- instruction injected into the brain's <runtime>
weight int default 1        -- selection weight
is_active bool default true
branch_id uuid null         -- optional per-branch override
```
Seed 8–10 rows. Admin can edit/disable/re-weight from Settings later (separate ticket). Catalogue lives in DB, **never in code**.

### 2. New column on `whatsapp_chat_settings`
- `nurture_angle_history jsonb default '[]'` — append the angle slug + ISO timestamp of every nurture sent.
- `last_nurture_text text` and `last_nurture_hash text` — for similarity dedupe (sha1 of normalised text).

### 3. Angle picker RPC: `pick_next_nurture_angle(chat_id uuid)`
- Reads `nurture_angle_history`, returns a random weighted active angle that has **not been used in the last 3 picks**.
- Falls back to least-recently-used if all angles have been cycled.
- Pure SQL, branch-aware.

### 4. Rewrite `supabase/functions/lead-nurture-followup/index.ts` body generation

For BOTH the inside-24h freeform path AND the outside-24h template path:

a. Call `pick_next_nurture_angle` → get `{slug, tone, prompt_hint}`.
b. Build the userMessage with:
   - lead context (name / partial_lead_data / first-touch source / branch),
   - last 3 outbound nurture texts (so the model is told **not** to repeat them),
   - the angle's `prompt_hint` + `tone`,
   - explicit "max 320 chars, one CTA, no price talk" rules (already in persona).
c. Run `generateOnce` against the existing `lead_nurture` persona — knowledge is auto-retrieved via `match_ai_knowledge` (RAG already wired), so the model pulls live brand facts (no hard-coding).
d. **Similarity guard:** sha1-normalise the candidate; if it matches `last_nurture_hash` or any of the last 3 hashes for this contact, regenerate once with `temperature: 0.9` and an explicit "phrase this completely differently" instruction. If still a collision, fall through to a **DB-stored** fallback (`retention_templates` table, filtered by `category='lead_nurture'` + angle) — not a string literal.
e. On send-success, persist `{angle, hash, text}` into `nurture_angle_history` + `last_nurture_text/hash`.

### 5. Template-path variables become dynamic
The `lead_nurture_followup` Meta template currently expects `popular_feature_1/2`. Replace those at runtime with two random USPs pulled from `ai_knowledge` rows tagged `kind='usp'` (or `category='offerings'`), so even the approved-template send rotates content.

### 6. Dedupe-key fix (kills the back-to-back duplicate Vishal saw)
Change `dedupe_key` from `lead_nurture:{chat_id}:{retry+1}` to:
```
lead_nurture:{chat_id}:{floor(now_epoch / cooldown_seconds)}
```
Two cron ticks inside the same cooldown bucket collapse to one dispatch — independent of whether `nurture_retry_count` has been written yet.

### 7. Backfill / one-time migration
- Seed `lead_nurture_angles` with 9 angles (SQL in migration).
- Backfill `nurture_angle_history = '[]'` on existing rows.
- Optional: write a one-shot job that scans the last 30 days of nurture sends, hashes them, and inserts the hashes into `last_nurture_hash` per contact so the dedupe guard works from day 1.

### 8. Observability
- Log every nurture decision into `automation_runs` with `{chat_id, angle, regenerated, fallback_used, hash}`.
- Add a "Nurture variety" tile to `/system-health`: 7-day distribution of angle slugs (should be roughly even). Flat-line on one angle = misconfiguration.

## Files to change

- **Migration** (new): create `lead_nurture_angles`, add 3 columns to `whatsapp_chat_settings`, create `pick_next_nurture_angle` RPC, seed angles.
- `supabase/functions/lead-nurture-followup/index.ts` — angle pick → AI generation for both paths, similarity guard, dynamic template vars, dedupe-key bucket, history persistence.
- `supabase/functions/_shared/ai-prompt.ts` — accept `extraRuntime` so the angle's `prompt_hint` and "do not repeat these N messages" block can be injected without touching persona.
- `src/pages/SystemHealth.tsx` — small "Nurture variety (7d)" card.

## Verification

1. Trigger `lead-nurture-followup` 5× in a row for a test phone — confirm 5 different angle slugs in `nurture_angle_history` and 5 distinct hashes.
2. Force a duplicate by mocking `generateOnce` to return the previous text — confirm the regeneration path fires and final text differs.
3. Fire two cron ticks within 1 s — confirm only one outbound row + one dispatch.
4. Query `automation_runs` for the last 24 h — angle distribution should span ≥4 distinct slugs across ≥10 sends.

Used the engineering-skills + senior-architect skills.