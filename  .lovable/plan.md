# Communication Hub Audit & Hardening Plan

Audit completed for Meta Template Management, Campaign Delivery, and Eco-System Health.

## Findings

- **Meta Eco-Error 131049:** Recipient `919928797971` hit a pacing limit (10:40 AM today). Meta blocks sends when engagement is low or frequency is too high for a specific template/recipient.
- **Template Status:** `invoice_pdf__whatsapp`, `payment_receipt_pdf__whatsapp`, and `feedback_request` are `PENDING_DELETION`, which causes fallback failures during automated sends.
- **Dispatcher Logic:** The `dispatch-communication` function (v1.27.0) is missing a clean "Suppressed" state for 131049 pacing in the UI, leading to confusing "Failed" entries without clear actionable next steps.
- **Quiet Hours Defect:** A bug in the retry worker meant messages deferred by quiet hours (11 PM - 7 AM) were inserted into `communication_retry_queue` with incorrect column names, causing them to never be sent.

## Proposed Actions

### 1. Eco-System Hardening (Terminal Errors)

- Update `parseCommError` to explicitly handle `131049` with a "Marketing Pacing" label.
- Modify `LiveFeed` to show a "Paced / Suppressed" badge for 131049 errors to differentiate them from technical failures.

### 2. Dispatcher Improvements

- Enhance `dispatch-communication` to check for recent 131049 failures to a recipient and auto-suppress marketing sends for 24h (Pacing Cooldown) to protect sender reputation.
- Fix the quiet-hours retry worker column mapping.

### 3. Template Management

- Implement a "Sync Status" indicator in the Templates Hub to warn when templates are `PENDING_DELETION` or `STALE`.

## Technical Tasks

- Edit `src/lib/comms/metaErrorLabels.ts` to include 131049 mapping.
- Edit `supabase/functions/dispatch-communication/index.ts` to implement pacing cooldown logic.
- Update `src/components/communications/DeliveryTimeline.tsx` with pacing-aware hints.

_Audit performed by Senior Architect & Engineering Lead._

Please update/create `lovable/plan.md` only.

IMPORTANT:

- Do NOT modify production code.
- Do NOT modify database tables or migrations.
- Do NOT change HOWBODY configuration.
- Do NOT deploy anything.
- This turn is documentation/planning only.

Use the HOWBODY 580/S580 API Docking Document v2.4 and the current Incline codebase as the source of truth.

The verified HOWBODY integration is:

HOWBODY API Base URL:
https://prodapi.howbodyfit.com/howbody-admin

Pre-scan Login URL:
https://theincline.in/scan-login

HOWBODY automatically appends:
?equipmentNo=...&scanId=...

The vendor documentation says scanId is valid for 5 minutes.

Send-to-Phone Redirect URL:
https://theincline.in/my-scan-report

This URL is fully static. HOWBODY does not append parameters.

Body Composition Push Webhook:
https://ivgqpbynzyrrgerniog.supabase.co/functions/v1/howbody-body-webhook

Posture Push Webhook:
https://ivgqpbynzyrrgerniog.supabase.co/functions/v1/howbody-posture-webhook

Device:
HD102026048117

Location:
Incline

IMPORTANT TERMINOLOGY:
The Login URL and Send-to-Phone URL are NOT webhooks.
Only Body Composition Push and Posture Push are inbound webhooks.

The current UI section called “Body Scanner Webhooks” should conceptually become:
“HOWBODY Integration URLs”
or
“HOWBODY URLs & Webhooks”.

Document the verified API contract:

POST /openApi/getToken

- userName
- appKey
- timeStamp
- token valid for 24 hours

POST /openApi/setUserInfo

- equipmentNo
- thirdUid
- scanId
- sex
- height
- age
- optional nickname/tel

HOWBODY body/posture reports contain:

- equipmentNo
- thirdUid
- dataKey
- scanId
- report data

dataKey is the unique report key.

Map the implementation to:

- src/components/settings/HowbodySettings.tsx
- supabase/functions/\_shared/howbody.ts
- supabase/functions/howbody-bind-user/index.ts
- supabase/functions/howbody-body-webhook/index.ts
- supabase/functions/howbody-posture-webhook/index.ts
- supabase/functions/deliver-scan-report/index.ts

CRITICAL BUSINESS RULE:

Body scanner access requires BODY entitlement only.

Allow if:

1. Active membership plan includes benefit `3d_body_scanning` and has remaining allowance; OR
2. Member has valid, non-expired `member_benefit_credits` for `3d_body_scanning` with credits remaining.

NEVER allow `howbody_posture` entitlement to substitute for body entitlement.

Therefore:

- body plan member -> ALLOW
- valid body add-on/credit member -> ALLOW
- posture-only member -> DENY
- posture add-on only -> DENY
- expired body credit -> DENY
- inactive/cancelled membership -> DENY
- plan allowance exhausted + valid body add-on -> ALLOW
- plan allowance exhausted + no body credit -> DENY

Consumption order:

1. Plan allowance first.
2. Body add-on/benefit credit only after plan allowance is exhausted.
3. Never consume both for one scan.
4. Duplicate HOWBODY webhook delivery must never double-consume credits.

KNOWN CURRENT BUG:

`supabase/functions/howbody-bind-user/index.ts` currently permits scanner binding when either body OR posture quota is allowed.

This violates the business rule.

Mark this as a critical future implementation item.
Do NOT fix it in this planning-only turn.

Also document a full future audit of:

- member_benefit_credits creation
- paid body add-on purchase
- payment/invoice linkage
- complimentary/admin grants
- expiry
- cancellation
- refunds/reversals
- FIFO consumption
- multiple credits
- branch handling
- RLS/RPC permissions
- atomic/race-safe credit consumption

Webhook/security audit must cover:

- App Key validation on both webhooks
- thirdUid/member mapping
- authorized equipmentNo
- scanId/session correlation
- 5-minute scanId validity
- scanId reuse
- cross-member binding
- memberId tampering
- duplicate dataKey
- duplicate webhook delivery
- forged webhook attempts
- unauthorized report creation

Document that inbound HOWBODY webhooks intentionally have Supabase JWT verification disabled because HOWBODY calls them directly, and current protection uses HOWBODY App Key validation.

Do not claim HOWBODY supports HMAC/signatures unless the vendor confirms it.

Report/privacy audit must include:

- raw full_payload retention
- RLS
- public report RPC projection
- public report token scope/expiry
- report delivery idempotency/retry
- PDF pagination issue in deliver-scan-report

Also document that WhatsApp/email delivery is Incline post-processing, NOT HOWBODY vendor behavior.

The plan must contain:

1. Source of Truth
2. Architecture
3. Verified URL Matrix
4. HOWBODY API Contract
5. Current Code Mapping
6. Critical Entitlement Rules
7. Known Findings by Severity
8. Implementation Phases
9. Test Matrix
10. Security/Privacy Checklist
11. Vendor Questions
12. Definition of Done
13. Planning Boundary

Include positive and negative tests, especially proving that a posture-only member can never start a body scan.

Explicitly state at the end:

“This document is planning/audit documentation only. Updating this document authorizes no production code, database, migration, entitlement, webhook, or configuration changes.”

After updating the file, report exactly what file was changed and do not make any other edits.
