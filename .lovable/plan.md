## Audit findings

### 1. `check-expired-access` vs `revoke-mips-access` — MERGE ✅

Both operate on the same MIPS hardware-access pipeline.

| | `check-expired-access` (134 LoC) | `revoke-mips-access` (265 LoC) |
|---|---|---|
| Trigger | cron sweeper, no args | per-member action |
| Operation | finds members whose membership lapsed and force-revokes | `action: 'revoke' \| 'restore'` for one member |
| Callers | `MIPSDashboard.tsx` (1) | `membershipService.ts` (2) |
| Auth | none (service-role) | none (service-role) |
| Shared code | MIPS login, person lookup, device dispatch, members.hardware_access_status update | same |

Both touch the same MIPS REST endpoints and write the same DB columns — the sweeper is essentially a batch wrapper around the per-member revoke. Merging is low risk.

**Proposal:** new function `mips-access` dispatched by `action`:
- `action: "revoke"` → existing per-member revoke logic
- `action: "restore"` → existing per-member restore logic
- `action: "sweep_expired"` → existing cron logic (internally calls the revoke branch per row)

### 2. Send-channel functions — KEEP (with one deletion)

These look duplicated but they're actually a strategy pattern under `dispatch-communication`:

| Function | LoC | Callers | Verdict |
|---|---|---|---|
| `dispatch-communication` | (core) | 8 (canonical entrypoint per memory) | keep |
| `send-whatsapp` | 359 | `dispatch-communication` + `WhatsAppChat` (2 direct sends) | keep — channel driver |
| `send-sms` | 266 | `dispatch-communication` + `leadService` (4) | keep — channel driver |
| `send-email` | 532 | `dispatch-communication` | keep — channel driver |
| `send-message` | 268 | **0 callers anywhere** | **DELETE — dead code** |
| `send-reminders` | 761 | cron + `communicationService` | keep — reminder orchestrator, not a channel driver |

Merging the three channel drivers into one would balloon a single function with Meta/Cloud + WATI + AiSensy + MSG91 + RoundSMS + Twilio + SendGrid + Mailgun + SMTP + SES code paths. That trades 3 focused files for one ~1200-line megafile and increases cold-start surface. Not recommended.

**Proposal:** delete `send-message` only.

### 3. Meta functions — MOSTLY KEEP, merge two internals

| Function | Why it must stay separate |
|---|---|
| `meta-webhook` | Registered with Meta as the WhatsApp/IG/FB webhook URL — renaming breaks production. |
| `meta-oauth-callback` | Registered as Meta app OAuth redirect URI. |
| `meta-data-deletion` | Registered as Meta GDPR data-deletion URL (legal requirement). |
| `whatsapp-webhook` | Separate webhook URL registered with Meta. |

These four URLs are externally bound. Renaming or folding them requires also updating the Meta App Dashboard — not safe to do without the user confirming each URL change in Meta.

| Function | Callers | Verdict |
|---|---|---|
| `meta-subscribe` (130 LoC) | 1 internal | merge candidate |
| `meta-diagnose` (234 LoC) | 1 internal | merge candidate |

**Proposal:** merge `meta-subscribe` + `meta-diagnose` into one internal admin function `meta-admin` dispatched by `action: "subscribe" | "diagnose"`. No external Meta-registered URLs are touched.

### 4. Recommendations not implemented unless you ask

- `leadService.ts` directly invokes `send-sms` 4× — the project's canonical rule is that all outbound comms go through `dispatch-communication`. Routing those through the dispatcher would be a behavior change, not a merge — flag only.
- `WhatsAppChat.tsx` direct `send-whatsapp` invocations are intentional (free-text agent replies, not templates) — leave them.

---

## Implementation plan

### A. Create `mips-access` (merges `check-expired-access` + `revoke-mips-access`)
- Single file `supabase/functions/mips-access/index.ts`.
- Shared helpers (MIPS auth, person lookup, device dispatch, formatDate) defined once.
- Body schema: `{ action: "revoke" | "restore" | "sweep_expired", member_id?, reason?, branch_id? }`.
- `sweep_expired` reuses the per-member revoke branch in a loop, preserving the original report shape `{ revoked: [...], errors: [...], count }`.
- Update callers:
  - `src/services/membershipService.ts` (2 sites) → `invoke('mips-access', { body: { action, member_id, ... } })` (already passing `action`).
  - `src/components/devices/MIPSDashboard.tsx` (1 site) → `invoke('mips-access', { body: { action: 'sweep_expired' } })`.
- `supabase/config.toml`: add `[functions.mips-access]` with `verify_jwt = true` for revoke/restore. Sweep is service-role-gated by being called only from the dashboard with a logged-in user.
- pg_cron / scheduler: check if `check-expired-access` is scheduled. If yes, repoint the cron entry to `mips-access` with `body: { action: 'sweep_expired' }`. (I will inspect `cron.job` during build and migrate if needed.)
- Delete `supabase/functions/check-expired-access/` and `supabase/functions/revoke-mips-access/`.
- `supabase--delete_edge_functions(["check-expired-access","revoke-mips-access"])`.

### B. Delete dead `send-message`
- Remove dir + `[functions.send-message]` config block + `supabase--delete_edge_functions(["send-message"])`.

### C. Create `meta-admin` (merges `meta-subscribe` + `meta-diagnose`)
- New `supabase/functions/meta-admin/index.ts` dispatched by `action: "subscribe" | "diagnose"`.
- Update the 2 callers to invoke `meta-admin` with the action.
- Remove old dirs + config + deploy/delete tools.
- Leave `meta-webhook`, `meta-oauth-callback`, `meta-data-deletion`, `whatsapp-webhook` untouched.

### Validation
- Build passes typecheck.
- `MIPSDashboard` "Check expired access" button still returns the same `{ revoked, errors }` shape.
- Manual revoke/restore from member actions in `membershipService.ts` still mutates `hardware_access_status` and writes the audit log row.
- Curl `mips-access` with each action and verify responses.
- Check `cron.job` for any `check-expired-access` schedule and update it.

### Files touched
- new: `supabase/functions/mips-access/index.ts`, `supabase/functions/meta-admin/index.ts`
- edit: `supabase/config.toml`, `src/services/membershipService.ts`, `src/components/devices/MIPSDashboard.tsx`, the 2 meta-admin callers
- delete: `supabase/functions/{check-expired-access,revoke-mips-access,send-message,meta-subscribe,meta-diagnose}/`
- migration (only if cron job exists): repoint pg_cron entry

### Net result
- Edge functions removed: 5 (`check-expired-access`, `revoke-mips-access`, `send-message`, `meta-subscribe`, `meta-diagnose`)
- Edge functions added: 2 (`mips-access`, `meta-admin`)
- No external Meta-registered URLs changed
- No behavior changes for the send-channel pipeline

Proceed?