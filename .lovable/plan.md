## Problem

In the Live Feed, the same notification (e.g. "New Lead: Devraj Mathur" → Rajat Lekhari) appears as two rows: one for Email and one for SMS. They should collapse into a single row with both channel badges (WA · SMS · Email · In-App), exactly like the design already supports for grouped rows.

## Root cause

`src/components/communications/LiveFeed.tsx` builds a `baseKey = recipientKey | dedupe_key|fingerprint` to group logs:

- **Recipient key differs per channel**: email row uses `e:rajat.lekhari@hotmail.com`, SMS row uses `p:+919887601200` — so they never share a bucket even though both reach the same person.
- **Dedupe key is channel-scoped**: `notify-lead-created` writes `lead:<id>:<channel>:<suffix>`, so email and SMS have different dedupe keys.
- Fallback fingerprint also differs because the email subject/body and SMS body are worded differently.

Result: two rows instead of one grouped row.

## Fix (LiveFeed.tsx only, ~15 lines)

1. **Unify recipient identity across channels.** In `recipientKey(l)`:
   - If `l.member_id` → keep `m:<member_id>`.
   - Else if `resolveName(l)` returns a name → use `n:<lowercased name>` (this is what already powers the row's display name, so it's a trustworthy cross-channel identity).
   - Else fall back to the existing phone/email keys.

2. **Strip channel suffix from `dedupe_key` before grouping.** Normalize trailing `:wa|:whatsapp|:sms|:em|:email|:in_app|:in` (case-insensitive) off `l.dedupe_key` inside `baseKey(l)` so `lead:<id>:sms:...` and `lead:<id>:email:...` collapse to the same bucket.

3. Leave the 10-minute window, `channels` map, badge rendering, expanded view, and KpiStrip untouched — the existing grouped UI (chips with per-channel icon + status dot + count) already renders correctly once two logs share a bucket.

## Out of scope

- No DB / edge-function changes (dedupe keys stay per-channel for the dispatcher's own dedupe logic; we only collapse them for display).
- No changes to KPI counts, channel tabs, search, pagination, or expanded delivery timeline.
- No changes to `notify-lead-created` or other senders.

## Verification

- Reload Communications → Live Feed: the four rows in the screenshot (Rajat × 2, Yogita × 2) should become **2 rows**, each with two channel chips (Email + SMS). One Yogita chip should show the red "failed" dot for SMS.
- Filtering by channel (WA / SMS / Email / In-App) still narrows correctly because filtering happens before grouping.
- WhatsApp / In-App rows that have no cross-channel sibling continue to render as single-channel rows.
