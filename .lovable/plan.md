# Plan — Dialog centering + AI follow-up opt-out

## Issue 1 — "Clear logs" / "Resolve all" dialogs not visually centered

### Root cause
`src/components/ui/alert-dialog.tsx` uses `fixed left-[50%] top-[50%] translate-x/y(-50%)` — correct *viewport* centering. But on desktop the visible content area sits to the right of a ~256px sidebar, so a viewport-centered modal looks shifted **left** relative to where the user's eye is focused (the content table). The screenshots also show inconsistent styling vs. the rest of the app (square `rounded-lg`, no Vuexy shadow, dense padding).

### Fix
Upgrade the shared `AlertDialog` primitive used by all three dialogs (SystemHealth resolve-all, SystemHealth clear-resolved, AICallLogs clear):

1. **Sidebar-aware centering on desktop**
   - Read `--sidebar-width` (already exposed by `components/ui/sidebar.tsx`) and offset the overlay + content by half that width on `md:` and up, so the modal optically centers over the main content area.
   - Mobile (< md) stays viewport-centered.
   - When sidebar is collapsed/offcanvas, fall back to viewport center (use `peer-data-[state=collapsed]` or check the CSS var resolves to 0).

2. **Vuexy visual polish** (per project knowledge)
   - `rounded-2xl`, `shadow-2xl shadow-slate-900/10`, `border-0`, `p-7`, `max-w-md`
   - Header: 40px circular icon badge slot (destructive = `bg-red-50 text-red-600`, default = `bg-indigo-50 text-indigo-600`)
   - Title `text-lg font-bold text-slate-900`, description `text-sm text-slate-500 leading-relaxed`
   - Footer: right-aligned, `gap-2`, primary action takes brand/destructive variant from `buttonVariants`
   - Overlay: `bg-slate-900/40 backdrop-blur-sm` instead of solid `bg-black/80`

3. **Accessibility**
   - Keep Radix focus trap, add `aria-describedby` link, ensure 44px min touch targets on footer buttons.

No call-site changes needed — all three dialogs inherit automatically.

### Files
- `src/components/ui/alert-dialog.tsx` — overlay + content styling, sidebar-aware offset
- (optional) add a tiny `icon` slot prop to `AlertDialogHeader` so SystemHealth/AICallLogs can pass a `Trash2` / `CheckCheck` icon — backward compatible.

---

## Issue 2 — AI keeps following up after lead said "don't message me"

### Evidence
WhatsApp transcript:
> Lead 20:43: "Tb tk baar baar msg mat kro" (don't message me again and again)
> AI 20:43: "Bilkul Yogita, main aapko disturb nahi karungi…"
> AI next day 01:30: sends `Hi Yogita! We're closing our Founding Member entries soon…`

### Root cause
`supabase/functions/lead-nurture-followup/index.ts` only checks:
- `nurture_retry_count` < max
- `last_nurture_at` cooldown
- 24h Meta window / approved template
It has **no opt-out / do-not-contact gate**. The WhatsApp AI agent acknowledges the request conversationally but never persists a flag, and the nurture cron has no signal to skip the lead.

`supabase/functions/run-retention-nudges/index.ts` has the same gap for members.

### Fix (3 layers)

**A. Schema**
Add to `whatsapp_chats` (and mirror on `leads` for already-converted leads):
- `do_not_contact boolean default false`
- `do_not_contact_reason text` (e.g. `lead_request`, `manual`, `keyword_match`)
- `do_not_contact_until timestamptz null` (null = forever; allow temporary "after July" style snoozes)
- `do_not_contact_set_at timestamptz`

**B. Detection (incoming message pipeline)**
In `dispatch` of inbound WhatsApp messages (the existing AI auto-reply / inbox webhook handler), add a `detectOptOut(text)` step:
1. **Fast regex (multi-lingual incl. Hinglish)** — `stop|unsubscribe|don'?t (call|message|text|contact)|do not (call|message|text|contact)|msg mat kar|baat mat kar|disturb mat kar|call mat kar|band kar|remove me`
2. If no keyword hit, run a cheap Lovable AI classification (`gemini-3-flash-preview`, JSON output `{opt_out: bool, until: iso|null, reason: string}`) — only when message tone is negative (skip on simple greetings).
3. On positive detection:
   - Set `do_not_contact = true`, `do_not_contact_reason='lead_request'`, `do_not_contact_until = parsed.until` (or null).
   - Log an `audit_log` entry and create a `tasks` row for staff visibility.
   - Send a single confirmation reply (template-safe), then stop.

**C. Honor the flag everywhere**
- `lead-nurture-followup`: extend the `.select(...)` to include `do_not_contact, do_not_contact_until`, and add a `.eq('do_not_contact', false).or('do_not_contact_until.is.null,do_not_contact_until.lt.now()')`-equivalent JS filter that **also early-returns** before any AI call.
- `run-retention-nudges`: same filter on members.
- `send-broadcast` / `run-campaign` / `dispatch-communication`: drop recipients whose contact (matched by phone) has `do_not_contact=true` and log `skipped_do_not_contact` in `campaign_recipients`.
- WhatsApp AI agent tool registry: add `setDoNotContact(lead_id, until?, reason)` so the agent itself can flip the flag when it understands the user's intent, instead of only replying conversationally.

**D. UI surface**
- Member/Lead profile drawer: small "Do not contact" toggle badge with reason + set_at + optional until-date; staff can clear it.
- ContactBook list: show a red `Do not contact` chip on rows with the flag.

**E. Memory backfill**
Add a new memory entry `mem://features/do-not-contact-engine` and a Core line:
> All outbound nurture/campaign/retention sends MUST check `do_not_contact` on whatsapp_chats/leads/members. Inbound pipeline auto-detects opt-out via regex + AI classifier and sets the flag.

### Files
- New migration: columns + index on `(do_not_contact, branch_id)`
- `supabase/functions/_shared/optOutDetector.ts` — regex + AI classifier helper
- `supabase/functions/ai-auto-reply/index.ts` (and/or the WhatsApp inbox webhook) — call detector before AI reply
- `supabase/functions/lead-nurture-followup/index.ts` — filter
- `supabase/functions/run-retention-nudges/index.ts` — filter
- `supabase/functions/send-broadcast/index.ts` + `run-campaign/index.ts` — filter
- `supabase/functions/_shared/ai-tools.ts` + `ai-tool-executor.ts` — new `set_do_not_contact` tool
- WhatsApp agent system prompt — instruct: "If user asks to stop/pause messages, call `set_do_not_contact` and confirm once."
- `src/components/leads/LeadProfileDrawer.tsx` + `src/pages/ContactBook.tsx` — UI badge + toggle
- Memory file `mem://features/do-not-contact-engine` + index update

---

## Out of scope (flag for follow-up if you want)
- Bulk import of historical "opt-out" mentions from past conversations (we can run a one-time backfill script after the detector ships).
- SMS/Email STOP-keyword DLT-compliant handling (separate work, India regs).

## Questions before I implement
1. **Dialog centering**: do you want it optically centered over the content area (sidebar-aware, my recommendation), or strictly viewport-centered with just the Vuexy restyle?
2. **Opt-out scope**: should detection set the flag *globally* (no campaign/nurture/retention ever) or only stop AI nurture while still allowing manual staff outreach? My recommendation: global with a staff "Override & message anyway" confirmation.
3. **Confirmation reply** after auto opt-out — single-line template ("Got it, I won't message again. Reach us anytime at <branch phone>.") OK, or you want different copy?
