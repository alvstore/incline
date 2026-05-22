# Founder's Phase v3.6 + Live Feed scroll + Lead-alert reliability

## 1. Plan duration & fitness goal — interactive 4-option lists (not free text)

**Why:** Free-text capture confuses members and produces dirty data. We had this working before as Meta `interactive_list` blocks; v3.5 stripped them. Restore as ordered, normalized lists after name+email are captured.

**`supabase/functions/_shared/ai-agent-brain.ts` → v3.6.0**
- `askNextMissing()` for `goal` and `plan_interest`: stop returning plain text. Emit a JSON payload of shape:
  ```
  { type:"interactive_list", body:"…", button:"Choose", sections:[{ title, rows:[{id,title,description?}, …] }] }
  ```
  - Goal rows (4): Weight Loss · Muscle Gain · Endurance · Flexibility / General
  - Plan-interest rows (4): Monthly · Quarterly · Half-Yearly · Annual (Founding)
- Prompt rewrite (`buildLeadCapturePrompt`):
  - Turn 3 (after email): **emit goal interactive_list** (the 4 options above). No free-text fallback.
  - Turn 4 (after goal): **emit plan_interest interactive_list** with the 4 durations. Annual row labeled "Annual — Founding Member".
  - Remove the "DO NOT emit any plan_interest / fitness-goal interactive_list" lines added in v3.4/3.5.
  - Keep the HARD GATE: no interactive blocks until name+email both present.
- Keep the deterministic capture in `extractFactsFromMessage()` that maps `list_reply.title` → `plan_interest` / `goal` (already implemented).

**`supabase/functions/whatsapp-webhook/index.ts`**
- Replace the "Founder's Phase strip-all-durations" block (lines ~612–632) with a narrower filter that **only strips price / Day-Pass / PT-package rows**. Allow `monthly|quarterly|half-yearly|annual` rows through.
- Keep the no-price text sanitizer (`FORBIDDEN_PRICE_TEXT_RE`) untouched.

**DB:** Backfill `ai_purposes.config.whatsapp_reply.target_fields = ['name','email','goal','plan_interest']` (already correct). Clear stale `do_not_ask:['goal','plan_interest']` rows in `ai_memory` so existing pre-opening leads (Rajat, etc.) get re-asked with the new lists.

## 2. Communication Hub → Live Feed cannot scroll

**Root cause:** `<ScrollArea className="max-h-[600px]">` wraps the list. Radix `ScrollArea` requires an explicit **height** on the viewport, not `max-h`, otherwise the viewport collapses to content size and the inner scrollbar never engages — the list overflows the card and the only scroller is the page itself, which on this screen is already at the bottom.

**Fix in `src/components/communications/LiveFeed.tsx`:**
- Replace the `<ScrollArea max-h-[600px]>` wrapper with a plain `<div className="max-h-[70vh] overflow-y-auto overscroll-contain">`. This is what we use elsewhere in the Hub and avoids the Radix viewport-height bug.
- Use `70vh` (not fixed `600px`) so it adapts to the 693 CSS-pixel viewport the user is on.
- Keep the divider/animation styling.

## 3. New-lead notification to Yogita — audit & hardening

**What actually happened (from `communication_logs` 16:20:31):**
- Email to `yogitamotiramani@hotmail.com` → **sent ✓** (twice — one per duplicate lead row).
- WhatsApp to `+91 99289 10901` → marked `status='sent'` in our table, but Meta returned **error 131049** in `error_message`:  
  `"This message was not delivered to maintain healthy ecosystem engagement."`
- SMS disabled by her admin pref (`sms_enabled=false`).

**Why 131049 fires:** Meta throttles **Marketing-category** templates per recipient when engagement is low or volume spikes. `internal_new_lead_alert` is almost certainly classified as Marketing in Meta Business Manager. Internal staff alerts must be **Utility** to bypass this throttle. Secondary symptoms: we record `status='sent'` even when Meta refused delivery, so the UI shows success.

**Fixes:**

a) **Reclassify the team-alert template** (manual + doc step):
   - In Meta Business Manager, change `internal_new_lead_alert` category from **Marketing → Utility** (re-submit for approval). Until that lands, fall back to step (b).

b) **`supabase/functions/notify-lead-created/index.ts`** (v3.1.0):
   - When `dispatch-communication` returns a Meta delivery error with code in `{131047, 131049, 131050, 131051, 131056}`, record it as `failed` on the log, **enqueue an SMS fallback** to the same admin/manager (uses the existing `team_alert_sms` body), and surface a `lead_alert_failed` `system_alerts` row so Owners see it.
   - Always include the lead's branch in the dedupe key so duplicate inbound webhooks don't trigger duplicate template sends (Rajat's lead was inserted twice within 1 s — that 2nd send is what tripped 131049).

c) **`whatsapp-webhook/index.ts` + `register-member`/lead-capture path**:
   - Add an idempotency guard on lead insert: `unique (phone, branch_id, captured_within_5_min)` via existing `notified_at IS NULL` claim — extend to **dedupe lead inserts** when `phone+branch_id` already has a lead created in the last 60 s. This eliminates the duplicate-lead → duplicate-alert pattern that's burning Meta quota.

d) **`dispatch-communication`**:
   - When Meta response body contains `error.code` in the throttle set above, write `status='failed'` (not `sent`), so Live Feed correctly badges it red and ops see it.

## Technical summary

| File | Change |
|---|---|
| `supabase/functions/_shared/ai-agent-brain.ts` | v3.6.0 — restore goal + plan_interest interactive_list emission, update prompt |
| `supabase/functions/whatsapp-webhook/index.ts` | Narrow Founder's-Phase strip to price/PT only; add 60s lead-dedup; allow duration rows |
| `supabase/functions/notify-lead-created/index.ts` | v3.1.0 — Meta throttle detection, SMS fallback, system alert, branch-scoped dedupe |
| `supabase/functions/dispatch-communication/index.ts` | Mark Meta throttle codes as `failed` not `sent` |
| `src/components/communications/LiveFeed.tsx` | Replace Radix ScrollArea with `max-h-[70vh] overflow-y-auto` div |
| DB (migration) | Clear stale `do_not_ask` for goal/plan_interest in `ai_memory`; ensure `ai_purposes` target_fields include both |
| Manual / docs | Re-categorize `internal_new_lead_alert` Meta template Marketing → Utility |

## Memory updates
- Update `mem://index.md` Core: "Founder's Phase v3.6 — goal + plan_interest captured via interactive_list (4 options each) after name+email. Non-annual plan-interest still captured for sales nurture; never refused."
- Add `mem://architecture/lead-alert-meta-throttle` documenting 131049 handling + Utility-category requirement for internal templates.

## Out of scope
- No UI changes beyond the LiveFeed scroll fix.
- No change to the Founding-Member confirm flow once annual is chosen (still single button).
