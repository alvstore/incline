# Integrations settings repair: webhooks, RCS, Google Places, human review replies

## What I verified in the live project

- The **Payment Webhook URL box is hardcoded to Razorpay** — `IntegrationSettings.tsx` builds it once via `getWebhookInfoForProvider('payment_gateway', 'razorpay', branch)` and shows it above all four gateway cards, so PhonePe/CCAvenue/PayU users copy a Razorpay URL. The helper already accepts a provider, so the URL *is* per-provider by design; only the UI is wrong.
- **RCS provider rows in the database:** `smartping` is `is_active = true`, `telinfy` is `is_active = false`. The hub prefers the active Smartping row, so it prints "RCS Hub — Smartping · Connected", while `send-rcs` actually falls back to the Telinfy lane. Active-flag alone is being treated as "connected", with no credential check and no live probe.
- **Google Business tab still runs the legacy lane.** "Discover Google Business IDs" calls `list_accounts` / `list_locations` on the My Business APIs, which are disabled/zero-quota on the Google Cloud project, and the brain converts every 429 into the misleading string *"Google rate-limited the request. Reviews will retry automatically on the next sync."* (`google-reviews-brain/index.ts:426`). Nothing retries.
- Meanwhile the **Feedback → External Reviews lane already works** through the linked Google Maps connector: branch `11111111-…` has `place_id = ChIJq7uKbjXvZzkRnYxCp0uL3uo` saved and Places returns the listing, rating and reviews. So Settings and Feedback are two different, contradicting lanes over the same integration.
- **AI reply drafting** uses one combined classify+draft call with the instruction *"draft a polite, professional reply (≤500 chars)"* — that single line is why every draft reads like a template.

## The work

### 1. Payment webhook URL — per provider, inside the provider

Remove the global Razorpay box from the Payment tab. Each gateway card gets its own webhook row rendered from `getWebhookInfoForProvider(type, provider.id, branch)`, and the full URL with copy button lives inside that provider's configure sheet, next to the credentials it belongs to. Cards show a short "Webhook ready / select a branch" state instead of a raw URL. Same treatment for the SMS/Meta/lead webhooks that already have provider-scoped URLs.

### 2. RCS — honest provider state, scoped webhooks

- Connection state stops being "row is_active". A provider counts as connected only when its required credentials exist **and** a lightweight reachability probe succeeds; otherwise it shows "Configured, not verified" or "Inactive".
- The hub header names the provider actually used for sending (resolved the same way `send-rcs` resolves it), so it can no longer claim Smartping while Telinfy sends.
- Webhook URLs move out of the global hub tab into each provider's card/sheet: Telinfy sees only Telinfy callbacks, Smartping only Smartping ones. The legacy unprefixed URLs keep working server-side.
- Wallet/Reports tabs stay hidden for providers that do not expose them (already partly handled).

### 3. Google — one lane, Places only

- Retire the legacy Business Profile discovery path: remove "Discover Google Business IDs" (`GoogleBusinessDiscovery.tsx`), the `list_accounts` / `list_locations` actions, and the manual Account ID / Location ID / API-key fields from the drawer. Delete the dead OAuth-key copy from the drawer and docs.
- Replace it with the **same "Find my listing" Places search** the Feedback tab uses, running through the linked Google Maps connector — search by name, pick the place, save `place_id`. One source of truth per branch.
- The Google card becomes a 3-step status tracker: **Listing linked → Reviews syncing (rating, count, last synced) → Replies**, with replies clearly marked as assisted (copy + open on Google) until Google grants Business Profile access.
- Kill the false "will retry automatically" copy. Each failure states the real cause and the one action that fixes it.
- Docs (`docs/google-reviews-ai-brain.md`) rewritten to describe the Places lane only.

### 4. Integrations page redesign

Vuexy pass across the tab: `rounded-2xl` cards, no borders, soft slate shadows, consistent provider tiles with logo + status badge + single primary action, secondary actions in a menu, skeleton loading states, and a per-tab health strip. Google and RCS get the redesigned card treatment described above. Frontend/presentation only.

### 5. Human-sounding review replies

Split the single AI call into **classify** and **draft**, and rewrite the draft prompt:

- Reply must reference something concrete from the review (the trainer, the ice bath, the cleanliness point) — generic replies are rejected and regenerated once.
- Mirror the reviewer's language and register, including Hinglish; use the reviewer's first name naturally, not "Dear Valued Customer".
- Length follows the review: one or two sentences for a bare 5★, longer and specific for a detailed or negative one.
- Banned phrases list ("We appreciate your valuable feedback", "We strive to", "at our esteemed facility", em-dash-heavy AI cadence), no emojis, no marketing pitch, no invented facts (never quote prices or an opening date, per the Founder's Phase rule).
- Negative reviews: acknowledge the specific problem, own it in one line, give a real next step (a name/number to reach), no defensiveness.
- Few-shot examples in the prompt drawn from Incline's actual tone, and the branch persona from `ai_purposes.review_reply` kept as the system layer.
- A "regenerate with a different angle" action so staff can get a genuinely different draft, not a reworded one.

### 6. Verification

Copy and inspect the webhook URL for each of the four gateways; force an RCS state mismatch and confirm the hub reports the real sender; run a Places listing search and a live fetch from Settings and confirm it matches the Feedback tab; re-draft replies for the 5 pending reviews and read them for template tells.

## Technical notes

- Frontend: `src/components/settings/IntegrationSettings.tsx`, `GoogleBusinessDrawer.tsx`, `rcs/RcsHub.tsx`, `src/config/providerSchemas.ts`; delete `GoogleBusinessDiscovery.tsx`.
- Edge: `supabase/functions/google-reviews-brain/index.ts` — drop `list_accounts`/`list_locations`, fix `friendlyGoogleError` taxonomy, add a Places `search_listing` action shared with Feedback, split `classify` into classify + draft with the new prompt and an anti-generic retry.
- No schema change expected; `integration_settings.config` keeps `place_id` and drops the unused `account_id`/`location_id` reads.

## What still needs Google (not codeable)

Posting replies through the API stays blocked until Google enables the Business Profile APIs and grants quota on your Cloud project. Everything above works without it; direct posting switches on automatically once access lands.
