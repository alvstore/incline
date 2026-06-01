# Plan: Audit-log actor names + WhatsApp 132001 self-healing

## Part A — Audit shows "System" for every staff/contract/trainer creation

### Root cause
`audit_log_trigger_function` resolves actor via `auth.uid()` → `profiles.full_name` → `auth.users.email`. When writes happen through edge functions using the **service-role key** (e.g. `create-staff-user`, `create-member-user`, `restore-staff`, `offboard-staff`, `purchase_membership` RPC called from server), `auth.uid()` is `NULL`, so the trigger falls back and the row is stored with `actor_name = NULL` → UI shows "System".

### Fix

1. **New shared helper** `supabase/functions/_shared/with-actor.ts`
   - Decodes the incoming user JWT (when present), resolves `{ actor_id, actor_name }` from `profiles`.
   - Exposes `async withActorContext(supabase, ctx, fn)` that runs `SELECT set_config('app.actor_id', $1, true); SELECT set_config('app.actor_name', $2, true);` then executes `fn()` inside the same connection (uses a single transaction via `rpc('exec_with_actor', …)` since pgrest service-role sessions are pooled — implemented as a SECURITY DEFINER RPC `audit_set_actor(p_id uuid, p_name text)` that pins both GUCs for the txn).
   - Plus a tiny RPC wrapper so the per-statement insert path also works: `audit_run_with_actor(p_id uuid, p_name text, p_sql_tag text)`.

2. **Migration**
   - Extend `audit_log_trigger_function`:
     - Read `app.actor_id` GUC; if set and `v_uid IS NULL` → use it as `user_id`.
     - Read `app.actor_name` GUC (already present) — keep priority above profile lookup.
     - When both still null, set `actor_name = 'System (' || COALESCE(current_setting('app.actor_source', true), 'automation') || ')'` so we can tell automation from genuine system jobs (cron, triggers).
   - **Backfill**: update last 90 days where `actor_name IS NULL AND user_id IS NOT NULL` by joining `profiles`.

3. **Edge functions to retrofit** (forward caller identity):
   - `create-staff-user`, `create-member-user`, `create-owner`, `restore-staff`, `offboard-staff`, `register-member`, `purchase_membership` callers, contract creation paths.
   - Each function: read `Authorization` header → `getUser()` → resolve full_name → call `audit_set_actor(uid, name)` once at start of request.

4. **AuditLogs UI** (`src/pages/AuditLogs.tsx`)
   - Join logs to `profiles` via `user_id` and prefer `profile.full_name` over `actor_name` when the latter is null/"System". Render "System" with an info icon + tooltip showing the source function (parsed from `action_description` / `record_id`) only when there is genuinely no user.
   - Avatar initials now come from the resolved name.

---

## Part B — WhatsApp 132001 (template missing in WABA) auto-healing

### Root cause
A template exists in our DB (`whatsapp_templates`) but no longer exists in the connected Meta WABA (deleted from Business Manager, renamed, or wrong language code). Dispatcher sends → Meta returns 132001 → user sees a raw error with no context and no recovery path.

### Fix

1. **Schema** — add columns to `whatsapp_templates`:
   - `meta_present boolean default true`
   - `last_meta_verified_at timestamptz`
   - `meta_last_error text`
   - Index on `(meta_present, status)`.

2. **New edge function `sync-whatsapp-templates`**
   - Pulls `GET /{waba_id}/message_templates?fields=name,status,language,category,components&limit=1000` (paginated).
   - Upserts into `whatsapp_templates` keyed on `(name, language)`; sets `status`, `category`, `meta_present=true`, `last_meta_verified_at=now()`.
   - Any local row not seen in Meta response → `meta_present=false`, `meta_last_error='not_in_waba'`.
   - Cron: every 6h via `automation-brain-tick` (add as a rule, not a new cron).
   - Manual trigger from Templates Hub button **"Re-sync from Meta"**.

3. **Dispatcher (`dispatch-communication`) update**
   - Template resolution query now requires `meta_present = true AND status = 'APPROVED'`.
   - If selected `template_id` from caller is `meta_present=false`, attempt fallback resolution; if none, suppress with reason `template_missing_in_waba` and return a friendly error pointing to the Templates Hub.

4. **`send-whatsapp` pre-flight (cheap, no extra API call in hot path)**
   - Before POSTing to Meta, look up the template's `meta_present` flag from DB. If false → return suppression error without burning a Meta call. (Already logs enriched context.)
   - On 132001 response: immediately `UPDATE whatsapp_templates SET meta_present=false, meta_last_error=$1, last_meta_verified_at=now() WHERE id=$2` and enqueue a one-shot `sync-whatsapp-templates` invocation so the next send has fresh data.

5. **Retry queue (`process-comm-retry-queue`)**
   - 132001 is already terminal. Add: 132001 **does NOT count** toward the 3-strike `do_not_contact` rule (it's a config bug, not a recipient issue).

6. **Templates Hub UI** (`Settings → Communication Templates → WhatsApp`)
   - Top banner if `count(meta_present=false) > 0`: "N templates not found in Meta — [Re-sync from Meta]".
   - Per-row badge: red "Missing in Meta" with tooltip showing `meta_last_error` and `last_meta_verified_at`.
   - "Re-sync from Meta" primary button on the CRM Templates and Meta Approved sub-tabs invokes `sync-whatsapp-templates` and refreshes the list.

7. **System Health link-through**
   - Errors with `context.meta_code = 132001` get a "Fix template" action button that deep-links to `Settings → Communication Templates → WhatsApp?template=<name>`.

---

## Technical notes

- `audit_set_actor` is `SECURITY DEFINER` so service-role can pin the GUC; uses `set_config(key, val, true)` (transaction-local) — safe across PgBouncer.
- Meta sync uses Graph API `v21.0` consistent with existing send code.
- All new edge functions follow standards: try/catch wrapper, `captureEdgeError`, version comment, strict CORS.
- No client `.eq()` on `meta_present` needed — dispatcher is server-side.

## Files

- **New**: `supabase/functions/_shared/with-actor.ts`, `supabase/functions/sync-whatsapp-templates/index.ts`, migration `2026xxxx_audit_actor_and_wa_meta_sync.sql`
- **Edit**: `audit_log_trigger_function` (migration), `create-staff-user`, `create-member-user`, `create-owner`, `restore-staff`, `offboard-staff`, `register-member`, `dispatch-communication`, `send-whatsapp`, `process-comm-retry-queue`, `src/pages/AuditLogs.tsx`, Templates Hub WhatsApp tab components
- **Schema**: `whatsapp_templates` (+3 cols), `audit_logs` backfill (90d)
