# HOWBODY 580 / S580 Integration — Audit & Implementation Plan

## 1. Source of Truth

- **Vendor spec:** HOWBODY 580/S580 API Docking Document **v2.4**.
- **Codebase:** current Incline repository (frontend + edge functions), read as-is.
- Where vendor doc and code disagree, the vendor doc defines the contract and the code is treated as a finding.
- Nothing in this document has been verified against the live HOWBODY tenant beyond the URLs and device listed below.

## 2. Architecture

```text
Member phone                HOWBODY device HD102026048117           Incline (Lovable Cloud)
-----------                 ------------------------------          -----------------------
scan QR on device  ---->  device shows login URL + params
   |                        ?equipmentNo=...&scanId=...
   v
/scan-login (Incline web) ------ auth + entitlement check ------>  howbody-bind-user edge fn
                                                                     |  POST /openApi/getToken
                                                                     |  POST /openApi/setUserInfo
                                                                     v
                          device performs scan  <---- session bound (thirdUid, scanId)
                                   |
                                   |  push report (App Key header)
                                   v
                    howbody-body-webhook / howbody-posture-webhook  --> howbody_*_reports
                                                                     --> deliver-scan-report
                                                                          (email / WhatsApp / in-app)
                                   |
        "send to phone" on device --+--> https://theincline.in/my-scan-report (static, no params)
```

Key point: the **Login URL** and the **Send-to-Phone URL** are member-facing web pages, **not webhooks**. Only the two Push URLs are inbound webhooks.

## 3. Verified URL Matrix

| Purpose | URL | Direction | Params | Auth |
|---|---|---|---|---|
| HOWBODY API base | `https://prodapi.howbodyfit.com/howbody-admin` | Incline → HOWBODY | n/a | token + appkey headers |
| Pre-scan Login URL | `https://theincline.in/scan-login` | Device → member browser | HOWBODY appends `?equipmentNo=...&scanId=...` | Incline member auth |
| Send-to-Phone Redirect | `https://theincline.in/my-scan-report` | Device → member browser | **none** (fully static) | Incline member auth |
| Body Composition Push | `https://ivgqpbynzyrrgerniog.supabase.co/functions/v1/howbody-body-webhook` | HOWBODY → Incline (webhook) | JSON body | HOWBODY App Key header |
| Posture Push | `https://ivgqpbynzyrrgerniog.supabase.co/functions/v1/howbody-posture-webhook` | HOWBODY → Incline (webhook) | JSON body | HOWBODY App Key header |

- Device: **HD102026048117** — Location: **Incline**.
- `scanId` validity per vendor doc: **5 minutes**.
- UI naming: the settings section currently titled **"Body Scanner Webhooks"** (`HowbodySettings.tsx:274`) should be renamed to **"HOWBODY Integration URLs"** (or "HOWBODY URLs & Webhooks") and visually split into *Member URLs* vs *Inbound Webhooks*. Cosmetic-only; deferred to Phase 1.

## 4. HOWBODY API Contract (v2.4)

**`POST /openApi/getToken`**

| Field | Notes |
|---|---|
| `userName` | tenant username |
| `appKey` | tenant app key |
| `timeStamp` | epoch ms |

Returns `code: 200` + `data.token`. **Token valid 24 hours.** Error text is returned in `msg` (not `message`).

**`POST /openApi/setUserInfo`** (headers: `token`, `appkey`, `timestamp`)

| Field | Required | Notes |
|---|---|---|
| `equipmentNo` | yes | device serial |
| `thirdUid` | yes | Incline-side stable member identifier |
| `scanId` | yes | session id from the QR, 5-minute validity |
| `sex` | yes | 1 male / 0 female |
| `height` | yes | cm |
| `age` | yes | years |
| `nickname` | optional | display name |
| `tel` | optional | phone |

**Push payloads (body & posture)** always carry: `equipmentNo`, `thirdUid`, `dataKey`, `scanId`, plus the metric block (body: healthScore/weight/bmi/pbf/smm/…; posture: score/headForward/highLowShoulder/…, image URLs, `murl` 3D model). **`dataKey` is the unique report key** and is the correct idempotency key. Webhooks must answer the HOWBODY envelope `{code, message, data}`.

## 5. Current Code Mapping

| File | Role | State |
|---|---|---|
| `src/components/settings/HowbodySettings.tsx` | Admin credentials + URL display/copy, test connection | Works; section title and grouping misleading (see §3) |
| `supabase/functions/_shared/howbody.ts` | Cred resolution (`integration_settings` → env fallback), 24h token cache in `howbody_tokens`, signed headers, `getExpectedWebhookAppKey`, `logWebhook` | Matches contract; token cached with 23h expiry and 5-min skew — correct |
| `supabase/functions/howbody-bind-user/index.ts` | Auth check, entitlement check, profile/height/age derivation, `setUserInfo`, `howbody_scan_sessions` upsert | **Contains the critical entitlement bug (§7 F-1)** |
| `supabase/functions/howbody-body-webhook/index.ts` | App Key check, member lookup by `thirdUid`, upsert on `data_key`, device touch, session complete, fire `deliver-scan-report` | Idempotent on `data_key`; no equipment allowlist, no scanId/member correlation |
| `supabase/functions/howbody-posture-webhook/index.ts` | Same shape for posture | Same gaps |
| `supabase/functions/deliver-scan-report/index.ts` | PDF build + email/WhatsApp/in-app delivery | Incline post-processing only; pagination + retry-idempotency concerns |
| `src/hooks/useHowbodyReports.ts` / `useLatestHowbodyScan.ts` | Member-facing report reads | Reads `howbody_*_reports` directly (RLS-dependent) |
| `src/pages/HowbodyLogin.tsx` / `src/pages/MyScanReport.tsx` / `HowbodyPublicReport.tsx` | `/scan-login`, `/my-scan-report`, public token report | Public report projection to review (§10) |
| RPC `howbody_scan_quota(_member_id, _kind)` | Entitlement source | Correct per-kind; caller misuses it |

## 6. Critical Entitlement Rules (business rule of record)

**Body scanner access requires BODY entitlement only.**

Allow if **either**:
1. Active membership plan includes benefit `3d_body_scanning` with remaining allowance; **or**
2. Member holds valid, non-expired `member_benefit_credits` for `3d_body_scanning` with credits remaining.

`howbody_posture` entitlement **may never** substitute for body entitlement.

| Scenario | Expected |
|---|---|
| Body plan member | ALLOW |
| Valid body add-on / credit | ALLOW |
| Posture-only member | **DENY** |
| Posture add-on only | **DENY** |
| Expired body credit | DENY |
| Inactive / cancelled membership | DENY |
| Plan allowance exhausted + valid body add-on | ALLOW |
| Plan allowance exhausted + no body credit | DENY |

**Consumption order:** (1) plan allowance first; (2) body add-on/benefit credit only once plan allowance is exhausted; (3) never consume both for a single scan; (4) duplicate HOWBODY webhook delivery must never double-consume credits (dedupe on `dataKey`).

## 7. Known Findings by Severity

**Critical**

- **F-1 — Posture entitlement grants body scanner access.** `howbody-bind-user/index.ts` evaluates both `howbody_scan_quota(body)` and `howbody_scan_quota(posture)` and proceeds when *either* returns `allowed`. A posture-only member can therefore start a body scan. Violates §6. **Not fixed this turn — Phase 1 item.**

**High**

- **F-2 — No credit consumption at scan time.** Quota is only *read* at bind; nothing decrements plan allowance or `member_benefit_credits`, so consumption order and single-consumption guarantees are unproven end-to-end.
- **F-3 — No authorized-equipment allowlist.** Webhooks accept any `equipmentNo`; `howbody_touch_device` auto-registers unknown devices.
- **F-4 — No scanId ↔ member correlation on inbound push.** Reports are attributed purely from `thirdUid`; a push whose `scanId` belongs to a different member's session is still accepted.

**Medium**

- **F-5 — `full_payload` retained verbatim** on both report tables (includes image/model URLs and all raw metrics); no retention policy.
- **F-6 — Public report token scope/expiry** and the public RPC projection need re-verification against PII minimalism.
- **F-7 — `deliver-scan-report` PDF pagination**: long posture/body metric sets can overflow a single page; content may be clipped.
- **F-8 — Delivery retry idempotency**: `deliver-scan-report` is invoked fire-and-forget from both webhooks; a redelivered `dataKey` can re-send email/WhatsApp.

**Low**

- **F-9 — UI terminology**: "Body Scanner Webhooks" mislabels two member-facing URLs as webhooks (§3).
- **F-10 — `howbodyCreds()` legacy sync helper** in `_shared/howbody.ts` is dead/env-only; remove after confirming no callers.

## 8. Implementation Phases (future turns)

**Phase 1 — Entitlement correctness (blocking)**
1. `howbody-bind-user`: require `body.allowed === true` for body scans; require `posture.allowed === true` for posture; never cross-substitute. Return a precise denial reason per §6 table.
2. Introduce an explicit scan `kind` on the bind request/session so entitlement, consumption, and reporting all agree.
3. Rename the settings section and regroup URLs (§3).

**Phase 2 — Atomic consumption**
4. Server-side RPC `howbody_consume_scan(_member_id, _kind, _data_key)`: plan allowance first, then FIFO body credit, single row-locked transaction, idempotent on `_data_key`.
5. Call consumption from the webhook (on confirmed report), not from bind, so abandoned sessions cost nothing.

**Phase 3 — Webhook hardening**
6. Equipment allowlist (`howbody_devices.authorized`), reject unknown `equipmentNo` with audit log.
7. Correlate `scanId` → `howbody_scan_sessions.member_id` and reject mismatches against `thirdUid`.
8. Enforce 5-minute `scanId` validity and single-use at bind time.

**Phase 4 — Reporting / privacy / delivery**
9. `full_payload` retention policy + column-level RLS review.
10. Public report token: short TTL, single report scope, minimal projection.
11. Fix PDF pagination; make delivery idempotent per (`data_key`, channel).

**Phase 5 — Credit lifecycle audit** (full scope in §9 checklist below)

## 9. Test Matrix

**Entitlement (positive)**
- Body plan, allowance remaining → bind succeeds.
- Body add-on credit valid, no plan benefit → bind succeeds.
- Plan allowance exhausted + valid body add-on → bind succeeds, credit consumed, plan untouched.
- Posture plan member requesting **posture** scan → succeeds.

**Entitlement (negative — must all DENY)**
- **Posture-only member requests body scan → DENY** (regression test for F-1; assert response `403` and that no `setUserInfo` call is made).
- Posture add-on only → DENY body.
- Expired body credit → DENY.
- Zero-credit body add-on → DENY.
- Inactive / cancelled / frozen membership → DENY.
- Plan allowance exhausted, no credit → DENY.

**Consumption**
- One scan never decrements both plan allowance and a credit.
- FIFO across multiple valid credits (earliest expiry first).
- Duplicate webhook for same `dataKey` → exactly one consumption.
- Concurrent binds for the same member → no negative balance (row lock proven).

**Webhook / security**
- Missing / wrong App Key → 401, logged, no row written.
- Unknown `equipmentNo` → rejected.
- `thirdUid` with no member → 404, logged.
- Expired (>5 min) `scanId` → bind rejected.
- Reused `scanId` → rejected.
- `memberId` tampering on bind (member A body, member B id) → rejected by auth ownership check.
- Cross-member binding attempt → rejected.
- Duplicate `dataKey` → single report row, no duplicate delivery.
- Forged payload without App Key → rejected.

**Reports / delivery**
- Long posture report → PDF renders all sections across pages.
- Delivery retried twice → member receives one message per channel.
- Public report link after expiry → denied.

## 10. Security / Privacy Checklist

- Inbound HOWBODY webhooks intentionally run with **Supabase JWT verification disabled** because HOWBODY calls them directly with no Supabase credentials. Current protection is **HOWBODY App Key header validation** plus `howbody_webhook_log` auditing. **No claim is made that HOWBODY supports HMAC or request signatures** — that must be confirmed with the vendor (§11) before any signature-based control is designed.
- App Key comparison should be constant-time and case-normalised across `appkey`/`Appkey`/`APPKEY`.
- Credentials live in `integration_settings` (`body_scanner` / `howbody`, global row) with env fallback; never logged.
- `member_benefit_credits`: RLS + RPC-only mutation; no client-side writes.
- Report tables: member reads own rows only; staff reads branch-scoped.
- `full_payload` retention window to be defined; image/model URLs treated as member PII.
- Public report RPC: minimal projection, tokenised, short TTL, revocable.
- **WhatsApp / email report delivery is Incline post-processing** (`deliver-scan-report` → `dispatchCommunication`), **not HOWBODY vendor behaviour**; HOWBODY's own "send to phone" only opens the static `/my-scan-report` page.

**Credit lifecycle audit scope (Phase 5):** `member_benefit_credits` creation paths; paid body add-on purchase; payment/invoice linkage; complimentary/admin grants; expiry handling; cancellation; refunds/reversals; FIFO consumption; multiple simultaneous credits; branch handling; RLS/RPC permissions; atomic race-safe consumption.

## 11. Vendor Questions (HOWBODY)

1. Does the push webhook support HMAC/signature verification or IP allowlisting, beyond the App Key header?
2. Is `scanId` single-use, and is the 5-minute window measured from QR display or from `setUserInfo`?
3. Retry policy for pushes — how many attempts, over what window, and is `dataKey` stable across retries?
4. Can the Send-to-Phone redirect be configured to append `dataKey` or `scanId`?
5. Are report image/model URLs permanent or expiring, and what is their access control?
6. Is `thirdUid` length/charset constrained, and can it be rotated?
7. Can `setUserInfo` declare the intended scan kind (body vs posture)?

## 12. Definition of Done

- Posture-only members provably cannot start a body scan (automated negative test in CI).
- Entitlement decisions match every row of the §6 table.
- Exactly one entitlement source consumed per scan; duplicate webhooks never double-consume.
- Webhooks reject unknown devices, mismatched sessions, and missing/incorrect App Keys, all audited.
- Report delivery is idempotent per (`data_key`, channel) and PDFs paginate correctly.
- Settings UI names member URLs and inbound webhooks distinctly.
- Vendor questions answered or explicitly logged as accepted risk.

## 13. Planning Boundary

This document is planning/audit documentation only. Updating this document authorizes no production code, database, migration, entitlement, webhook, or configuration changes.
