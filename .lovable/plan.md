## What I verified (live, this turn)

1. **Google Reviews is not rate-limited — the API is disabled.** The Google Business connection for the branch is fully OAuth-connected (refresh + access token valid, `account_id` + `location_id` saved). Calling `google-reviews-brain → test_connection` right now returns:
   `Google API 403: "Google My Business API has not been used in project 122775204755 before or it is disabled."`
   The "rate limit" text is our own generic message (`friendlyGoogleError`, 429 branch) shown for other failures. Review *reading* only exists on the legacy `mybusiness.googleapis.com/v4` API, which needs (a) the API enabled and (b) an approved Business Profile API quota request — until then every fetch fails.
2. **Invoice PDF over WhatsApp**: the send path *does* attach the PDF (`delivery_metadata.attachment` present, message reached `read`). The failure is the template: `invoice_generated_pdf` (`header_type=document`, APPROVED) has a corrupted `variables` array — it stores `["{{member_name}}"]` (double-braced, other vars missing). Result: the delivered text was "…your invoice for **attached**. The total amount due is **₹₹2,000** and the due date is **.**" and the document header params can't be built reliably. Several other document templates share the same corruption (`payment_receipt_pdf`, `pos_purchase_receipt_pdf`).
3. **Login button**: `/` renders `InclineAscent` (the public 3D site) and there is no link to `/auth` anywhere on it; `/register` also has no post-success login CTA.
4. **Registration welcome** already fires WhatsApp + Email via `dispatch-communication` in `register-member` (lines ~523-571) — but no SMS/RCS fallback and no login link/CTA in the message body.
5. **PT module**: `PTSessions.tsx` (1112 lines) has Packages / Active / Sessions tabs; monthly plans are inferred inconsistently (`package_type` in one place, `session_type` in another), so monthly packs render as session packs with meaningless counters.

---

## Plan

### 1. Google Reviews — dual-source pipeline (robust 2026)
- **Preflight diagnostics** in `google-reviews-brain`: new `action: "diagnose"` that reports, per branch: token OK, APIs enabled, quota state, and the *exact* Google error — never mislabels 403 as rate limit. Surface this in the Reviews settings card with an "action needed" checklist (enable *My Business Account Management*, *Business Information*, and *Google My Business (v4)* APIs; submit the GBP API quota form).
- **Places API fallback (works immediately, no approval)**: add `fetch_reviews_places` using `places.googleapis.com/v1/places/{place_id}?fields=reviews,rating,userRatingCount` with a server-side API key. Returns rating, review count and up to 5 recent reviews — enough to make the dashboard widget live today. Rows upsert into the same `google_reviews_inbound` table with `source='places'` (new column) so the GBP v4 path can later backfill full history and replies without duplicating.
- **Pacing + backoff** on the v4 path: sequential branches with jitter, exponential retry on 429/5xx, and a `last_fetch_error` stored on `integration_settings` so the UI shows the real reason instead of a toast.
- Wire the fetch to the existing Automation Brain (hourly rule) instead of ad-hoc calls.
- Requires one secret: a Google Maps Platform API key (Places API New enabled) — I'll request it when we get there.

### 2. Invoice PDF on WhatsApp (items 2 + 5, same root cause)
- **Repair template metadata** (migration): normalise `templates.variables` for all `type='whatsapp'` document templates — strip `{{ }}`, and derive the real variable list from `content` so it matches the Meta body placeholders exactly.
- **Guard in `dispatch-communication`**: when a template's declared `variables` don't match the placeholders parsed from `content`, parse from content instead of trusting the column (prevents silent `₹₹` / empty-slot renders forever).
- **Attachment assertion**: when `header_type='document'` and no `attachment.url` is supplied, fall back to the `{{document_link}}` body template (`payment_receipt_link`) rather than sending a header-less document template.
- Re-test end-to-end by re-sending one paid invoice to a test number and confirming the PDF arrives named `Invoice-XXX.pdf`.

### 3. Member Login button
- Add a **"Member Login"** action to `InclineAscent` (top-right, glass pill, `Link to="/auth"`) and a matching entry in the site footer — purely additive, no change to the 3D canvas or lead capture.
- Add a **"Log in to your account"** CTA on the `/register` success screen.

### 4. Post-registration welcome (all channels + login link)
- Extend the welcome block in `register-member` to dispatch WhatsApp → SMS → RCS → Email according to what's configured, each through `dispatchCommunication` (no direct `send-*`).
- Include member code **and** a login URL (`https://theincline.in/auth`) plus "set your password" guidance in variables; add a `member_welcome` template set with the login link variable.
- Ensure the member login is provisioned before the welcome fires so the link works on first click.

### 5. PT module redesign (`/pt-sessions`)
- Single source of truth for pack type: normalise on `package_type ∈ {session_based, monthly}` in one helper; delete the `session_type`/session-count guesswork.
- **Session packs** card: sessions used / remaining, expiry, trainer, progress ring.
- **Monthly packs** card: billing period, days remaining, renewal date, sessions attended this month (informational, not a cap).
- Tabs restructured to **Overview · Packages · Clients · Sessions**, dense list rows with sortable headers, status filters, skeletons, empty states, and Sheet-based actions (no dialogs).

### Technical notes
- New DB objects: `google_reviews_inbound.source`, `integration_settings.credentials.last_fetch_error`, template `variables` backfill migration.
- Edge functions touched: `google-reviews-brain`, `dispatch-communication`, `register-member`.
- Frontend touched: `InclineAscent.tsx`, `PublicRegistration.tsx`, `PTSessions.tsx` (+ extracted card components), Google Reviews settings card.
- Order of work: 2 → 3 → 4 (quick, high impact) → 1 (needs the Maps key) → 5 (largest).
