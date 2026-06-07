## Goal
Close the two **critical** "Missing Auth Gate" findings without breaking the cron caller (`automation-brain`) or any UI flow.

## Findings
1. **`lead-nurture-followup`** — no auth check. Cron-only function, but anyone on the internet can POST and trigger mass WhatsApp/SMS/email + burn AI credits.
2. **`score-leads`** — no auth check, no callers found in repo (orphan today). Still exposes PII reads, lead-score writes, and AI credit abuse to anyone on the internet.

## Fix

### A. `lead-nurture-followup` — adopt the canonical cron gate
Apply the exact pattern already used by `run-retention-nudges` v2.2.0:

- Accept **either** `Authorization: Bearer <service-role-key>` **or** `apikey=<service-role-key> + x-system-call=automation-brain` (this is how the master `automation-brain-tick` dispatcher invokes child workers — see `automation-brain/index.ts`).
- Reject everything else with HTTP 401.
- Inserted right after the OPTIONS handler, before the service-role client is created.

No change to business logic, response shape, or cron configuration. The hourly cron continues to fire (it already passes the service-role bearer via `automation-brain`), so the lead-nurture pipeline keeps running unchanged.

Bump header to `// v6.1.0 — service-role auth gate added`.

### B. `score-leads` — JWT + staff role gate
Pattern mirrors `create-member-user/index.ts`:

1. Read `Authorization: Bearer <jwt>`.
2. If header equals service-role key → allow (covers future automation use).
3. Else create an anon client with that bearer, call `supabase.auth.getUser()`.
4. With a service-role admin client, query `user_roles` for that user and require role ∈ `{owner, admin, manager, staff}`. (Trainers and members may not score leads.)
5. Return 401 if no JWT/invalid, 403 if role insufficient.

Existing PII fetch + AI scoring + `leads.score` update remain inside the gate, untouched.

Bump header to `// v2.1.0 — JWT + staff role gate added`.

## Validation
- Repo grep confirms no client/edge caller invokes `score-leads` today, so adding strict auth cannot regress any UI/cron path.
- `lead-nurture-followup` is invoked only by the `automation-brain` cron, which already sends `Authorization: Bearer <service-role>` — verified by the matching pattern in `run-retention-nudges` which was hardened the same way and continues to run on its hourly schedule.
- Smoke test after deploy:
  - `supabase--curl_edge_functions` POST `/lead-nurture-followup` with no auth → expect 401.
  - Same with `Authorization: Bearer <service-role>` (auto-injected by the tool when using the system header) → expect 200 + processed counts.
  - POST `/score-leads` with no auth → 401; with member-role JWT → 403; with admin JWT → 200.
- Both findings auto-close on the next security scan; no other findings are touched.

## Out of Scope
The remaining two **warn**-level findings in the same security report (`ai-draft-campaign-message` missing role check, `embed-knowledge` missing auth) are not in this request — flag them as the next ticket if you want them tackled in a follow-up pass.

## Risk
Very low. Only behavior change is that unauthenticated callers now receive 401 instead of running the function. No data, schema, or cron-schedule changes.

Approve to switch to build mode.
