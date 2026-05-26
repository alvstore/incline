## Why the WhatsApp send failed
`HRM.tsx` calls `dispatch-communication` for event `contract_fill_link` with a free-text `body`. WhatsApp Cloud API only accepts free text inside the 24-hour customer-service window; Ritesh is outside that window so Meta rejects the send. No approved template exists for this event yet — `contract_fill_link` is referenced **only** in `HRM.tsx` and is not in the system events catalog (`src/lib/templates/systemEvents.ts`), so the AI template generator never created a Meta template for it.

## Fix plan — two additions

### 1. Register `contract_fill_link` in the system events catalog
Add an entry to `src/lib/templates/systemEvents.ts` so it appears in:
- Settings → Communication Templates → WhatsApp → Coverage & AI (lets the user submit a Meta template for approval via the existing AI Studio flow)
- Settings → Communication Templates → WhatsApp → Automations
- The diff used by `AIGenerateTemplatesDrawer` so a one-click "Generate missing templates" run creates this one too

Event shape:
- key: `contract_fill_link`
- category: `transactional` (HRM)
- channels: `whatsapp`, `sms`, `email`
- body vars: `{{name}}`, `{{link}}`, `{{employer_name}}`
- header_type: `none` (it's a text+link message, not a document — so the document-event rule does **not** apply here)
- Default body copy that matches what HRM.tsx already sends, so an approved Meta template renders identically.

Dispatcher behaviour is already correct: when a Meta-approved template is mapped for the event, it sends as a template (works outside the 24h window). No edge-fn change needed — only the catalog registration so the user can mint the template.

### 2. Add a "Send via WhatsApp Desktop" (wa.me) option to the Share dropdown
In `src/pages/HRM.tsx`:

- Rename the existing item to **"Send via WhatsApp (API · uses approved template)"**.
- Add a new item **"Open in WhatsApp Desktop / Web (free)"** that:
  - Generates the fill link via `createContractSignLink(contract, 'employee', { sendWhatsApp: false, returnLink: true })` (refactor to optionally return the link instead of copying).
  - Normalises `contract._resolvedPhone` to bare digits (strip `+`, spaces, dashes — keep country code).
  - Opens `https://wa.me/<digits>?text=<encodeURIComponent(message)>` in a new tab via `window.open(url, '_blank', 'noopener')`.
  - The wa.me deep link is OS-aware — desktop users land on WhatsApp Desktop, mobile users on the mobile app.
  - Toast: "Opening WhatsApp Desktop — review and hit Send. No template fees."
- Also add **"Copy WhatsApp Desktop link"** so the user can paste it into a chat platform of their choice (Slack/email/etc.).

### 3. Smarter failure UX for the API path
Inside `createContractSignLink` when `dispatch.error` (or `dispatch.data?.error`) fires:
- Detect the `Outside 24h customer-service window` substring.
- Show a more helpful toast with two actions: **"Open WhatsApp Desktop"** (uses the wa.me deep link above) and **"Copy link"**. No silent clipboard fallback when the user clearly meant to send.

## Files to change
- `src/lib/templates/systemEvents.ts` — add `contract_fill_link` event entry (HRM / transactional / wa+sms+email / vars name·link·employer_name).
- `src/pages/HRM.tsx` — extend `createContractSignLink` with `returnLink` mode; refactor dropdown to two send options (API + Desktop) plus copy variants; fold 24h-window detection into the error toast.

## Out of scope
- Edge function logic (dispatcher already does template-first routing).
- Auto-generating/approving the Meta template — the user submits it from AI Studio after the catalog entry exists. The wa.me path keeps the feature usable while approval is pending.
- Witness / HR link sends (same pattern applies but the user didn't ask).
