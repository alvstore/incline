## Audit findings (from DB + code)

Looked at the actual rows behind your screenshot:

```
recipient                      channel  dedupe_key                 created_at
yogitamotiramani@hotmail.com   ''       (null)                     21:50:34   ← duplicate
yogitamotiramani@hotmail.com   email    lead:...:email:team:admin  21:50:33   ← real
rajat.lekhari@hotmail.com      ''       (null)                     21:50:39   ← duplicate
rajat.lekhari@hotmail.com      email    lead:...:email:team:admin  21:50:37   ← real
bhagirathbhau@gmail.com        ''       (null)                     21:50:40   ← duplicate
bhagirathbhau@gmail.com        email    lead:...:email:team:mgr    21:50:39   ← real
```

Only **one** `leads` row exists for Rajat and `notified_at` was set atomically — so `notify-lead-created` only fired once. The "multiple messages to same person" is **not** double-sending. It's **two `communication_logs` rows being written for every single email**, ~1 second apart.

### Root cause #1 — duplicate log inserts (email only)

Path: `notify-lead-created` → `dispatch-communication` → `send-email`.

- `dispatch-communication` inserts the canonical row with `channel='email'` + `dedupe_key` + `status='sending'` (line ~419 of dispatch-communication/index.ts).
- It then invokes `send-email` with `skip_log: true` (line ~698).
- **`send-email` ignores `skip_log`** and writes its own second row with `type='email'`, no `channel`, no `dedupe_key` (send-email/index.ts line 180).

`send-whatsapp` and `send-sms` already honor `skip_log` (note in send-whatsapp v2.2.0). Email is the odd one out — that's why only email appears duplicated in the feed, not WhatsApp/SMS.

### Root cause #2 — literal `\n\n` in email body

`lead_notification_rules.team_alert_email_body` is stored as:
```
A new lead was captured.\n\nName: {{lead_name}}\nPhone: ...\n\nPlease follow up at the earliest.
```
Those are 4 literal characters (`\`, `n`, `\`, `n`), not real newlines. Sent as HTML → renders as visible `\n\n`. The template renderer in `notify-lead-created` does only `{{token}}` substitution, no escape decoding.

### Why the new grouped Live Feed didn't collapse them

Grouping keys off recipient + dedupe_key (or content fingerprint) within a 10-min window. Both rows have the same recipient and same content body, so they SHOULD merge — but the duplicate row has `channel=''` and a different status path, which means the channel-chip cluster shows them as two separate channels. Once root cause #1 is fixed there's nothing left to group: one row per email per recipient.

---

## Fix plan (3 small changes, no schema migration)

### 1. `supabase/functions/send-email/index.ts` — honor `skip_log`
Read `skip_log` from the request body. Wrap the `communication_logs.insert` block with `if (branch_id && !skip_log)`. Mirrors what `send-whatsapp` v2.2.0 already does. Bumps to v1.x.0 with a comment.

### 2. `supabase/functions/dispatch-communication/index.ts` — normalize body whitespace for email
Just before invoking `send-email`, decode literal `\n` → real newline and convert to `<br>` so plain-text templates from `lead_notification_rules` render correctly inside the branded HTML shell:
```ts
const renderedHtml = String(input.payload.body || '')
  .replace(/\\r\\n|\\n/g, '\n')
  .replace(/\n/g, '<br>');
```
Pass `renderedHtml` as `html`. Leaves WhatsApp/SMS untouched (they handle `\n` natively).

### 3. Backfill the existing rule row (one-line SQL via migration)
```sql
UPDATE lead_notification_rules
SET team_alert_email_body = replace(team_alert_email_body, '\n', E'\n');
```
Stores real newlines going forward so the renderer can keep treating body as plain text and the email path converts to `<br>` consistently. Cosmetic only — no schema change.

### Out of scope (intentionally)
- No change to `notify-lead-created` claim logic (it's correct — single atomic claim per lead).
- No change to dispatcher dedupe_key / unique index.
- No change to Live Feed grouping (after fix #1 it's already right).
- No edits to WhatsApp/SMS senders.

### Verification after build
- Trigger one test lead → expect **one** `communication_logs` row per (admin × channel), no duplicates.
- Open the resulting email → newlines render as visible line breaks instead of `\n\n`.
- Live Feed shows one grouped row per recipient with WA + Email chips, no stacking.

### Files touched
| File | Change |
|---|---|
| `supabase/functions/send-email/index.ts` | Honor `skip_log` flag |
| `supabase/functions/dispatch-communication/index.ts` | Convert `\n` → `<br>` before sending email |
| New migration | Backfill `team_alert_email_body` to real newlines |
