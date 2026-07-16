## Cluster 1 — `mips_sweep_expired_access` 401 Unauthorized (27 occurrences)

**Root cause (confirmed by code read):**
- `automation-brain/index.ts` `callEdge()` invokes worker functions with headers `{ apikey: SERVICE_KEY, x-system-call: "automation-brain" }` — **no `Authorization` header**.
- `mips-access/index.ts` auth gate (v2.1.0, lines 434–461) only accepts `Authorization: Bearer <SERVICE_KEY>` OR a user JWT with owner/admin/manager role. It does not honor `x-system-call`.
- Result: every 30-min cron tick invokes `edge:mips-access` → 401 → automation_runs records `error`. This is the sole cause of the 27 occurrences.

**Fix (one file):** `supabase/functions/mips-access/index.ts`

Replace the auth gate to also accept the internal system-call header (mirroring the pattern already in `automation-brain/index.ts` v2.3.0):

```ts
const authHeader = req.headers.get("Authorization") || "";
const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
const apikey = req.headers.get("apikey") || "";
const sysCall = req.headers.get("x-system-call") || "";
const isService =
  (bearer && bearer === SERVICE_KEY) ||
  (apikey === SERVICE_KEY && sysCall === "automation-brain");
if (!isService) {
  // …existing user-JWT + role check unchanged…
}
```

Bump header to `// v2.2.0 — accept x-system-call from automation-brain`. Then redeploy `mips-access`, click **Run Now** on the rule, verify `automation_runs` shows `success` and `error_logs` count stops climbing.

---

## Issue 2 — MM (Meta Cloud) WhatsApp broadcast: "Test failed — Unknown" for marketing template

**Investigation plan (before code changes):**

1. **Reproduce with real curl** against `dispatch-communication` for `+919887601200`, using the exact template shown in the screenshot (`choose_what_deserves_your_effort`, category `marketing`). Capture:
   - Meta Graph API HTTP status + full JSON error (code / subcode / details).
   - Row written to `communication_logs` (delivery_status, error_message, provider_message_id).
2. Read `dispatch-communication/index.ts` marketing branch to confirm which of these fires:
   - 24h `pacing_cooldown_24h` suppression (docs/communication-dispatcher.md) → surfaces as `suppressed` but campaign UI may show "unknown".
   - Template-parameter mismatch (variable count vs. approved template body).
   - Header media missing for templates that require `image/video/document` header.
   - Wrong WABA/phone_number_id for MM (multi-tenant) — the "MM" provider row in `integration_settings` may be pointed at a different phone number than the approved template's WABA.
3. Inspect `campaign_recipients.error_message` / `communication_logs.error_message` for the last failed broadcast to `+919887601200` to get the concrete Meta error code.

**Most likely root causes (ranked, based on prior debugging patterns in this project):**

- **A.** Client-side "Test" button surfaces raw `Error` object without `.message` → user sees "Unknown". Actual failure is one of B/C/D below but hidden.
- **B.** Marketing template requires a **header media** (image/PDF) — Meta rejects with `#132000` "parameter_count_mismatch" when header is empty; template is approved but send-time payload omits header_handle. Dispatcher v1.6.0 injects `{{document_link}}` only for document-event templates, not marketing.
- **C.** Recipient outside 24h window + template variable resolution returns empty string → Meta rejects with `#132001` "template_param_missing".
- **D.** `pacing_cooldown_24h` from a prior `131049` on the same recipient — dispatcher inserts `suppressed` and returns without provider call; UI treats non-`sent` status as failure.

**Fix plan (executed after step 1–3 confirms the code):**

1. **`src/components/campaigns/CampaignWizard.tsx`** (or the "Test send" handler wherever "Test failed — Unknown" is thrown): surface `error.message ?? error.reason ?? JSON.stringify(error)` instead of bare "Unknown", and show the `communication_logs.error_message` when status is `failed` / `suppressed`.
2. **`supabase/functions/dispatch-communication/index.ts`**: for `channel='whatsapp' + category='marketing'` sends with a `template_id`, validate that any header component of type `IMAGE/VIDEO/DOCUMENT` has a corresponding `attachment_url` in the payload; return a specific error `template_header_media_required` instead of forwarding to Meta.
3. **`supabase/functions/send-whatsapp/index.ts`**: propagate Meta's `error.code`, `error.error_subcode`, and `error.error_data.details` verbatim into `communication_logs.error_message` so operators see the real cause.
4. **CURL harness**: add a new edge fn `whatsapp-template-probe` (service-role) that takes `{ template_name, recipient, variables?, header_media_url? }`, calls `/messages` directly on the currently-active MM integration row, and returns the full Meta response — for one-shot debugging without touching campaigns.
5. **End-to-end verify**: send the approved `choose_what_deserves_your_effort` template to `+919887601200` via the probe, then via the Campaign Wizard, and confirm both land or return a specific actionable error.

### Deliverables

- `supabase/functions/mips-access/index.ts` — auth-gate patch (Cluster 1, done in the same turn).
- `supabase/functions/whatsapp-template-probe/index.ts` — new debug function.
- `supabase/functions/dispatch-communication/index.ts` — header-media validation + verbose error passthrough.
- `supabase/functions/send-whatsapp/index.ts` — verbose Meta error capture.
- `src/components/campaigns/CampaignWizard.tsx` — surface real error message.
- Redeploy affected functions; test-send to +91 98876 01200 and paste the resulting `communication_logs` row.
