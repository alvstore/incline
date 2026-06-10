# AI Knowledge — "Embed failed" Audit & Fix

## Part 1 — Why three rows (persona + pricing_rules + booking_rules) is correct

You're not creating "duplicate Ananya personas". The three rows have different jobs in the RAG pipeline:

| Row | Topic | Priority | Purpose |
|---|---|---|---|
| Ananya — Member Concierge | `persona` | 2 | **Voice/identity** — always injected as the system persona |
| Pricing Embargo & Founder's Reservation Protocol | `pricing_rules` | 4 | **Hard rule** — what to say when price/fees come up |
| VIP Tour Scheduling Window | `booking_rules` | 5 | **Hard rule** — valid tour days/times |

All three have `priority ≤ 10`, so `retrieveKnowledge` injects **all of them into every reply** — Ananya already "knows" the pricing embargo and tour window on every message. The split exists so you can edit pricing without touching her voice (and vice-versa), and so the tour window can be re-generated from the editable `settings.tour_window` row.

Merging them into one giant persona row would (a) make the prompt brittle to edit, (b) break the planned "edit hours in Settings → auto-update knowledge row" flow, and (c) violate the existing `is_rule` convention used by Anti-parrot / Grounding rules. **Recommendation: keep the 3 rows. No data change needed.**

If you want the UI to make this clearer, we can add a small "Persona" / "Rule" badge next to the topic column so it's obvious at a glance that pricing_rules and booking_rules are rules attached to Ananya, not separate personas.

## Part 2 — Root cause of "Embed failed"

The two new rows show `Embed failed` because of an **auth mismatch between the DB trigger and the edge function**:

- `embed-knowledge/index.ts` (line 63) requires `Authorization: Bearer <SERVICE_ROLE_KEY>`.
- The DB trigger `tg_ai_knowledge_enqueue_embed` calls it with `Bearer <ANON_KEY>` (hardcoded in the migration `20260522142530_*.sql`).
- Result: every trigger-fired embed returns **401 Unauthorized**, the row never gets an `embedding`, UI shows "Embed failed".

The persona row shows "Ready" because it was embedded **before** the service-role gate was added (its `updated_at` is 2026-05-29; the gate was tightened after).

`pg_net.http_post` is fire-and-forget so the trigger never sees the 401 — the `exception when others` block also swallows it. That's why it silently fails.

## Part 3 — Fix Plan

### A. Fix the auth mismatch (one migration, no code change to edge fn)

1. Store the service-role key once in Vault: `select vault.create_secret('<service_role_jwt>', 'embed_knowledge_key');`
2. Rewrite `tg_ai_knowledge_enqueue_embed` to read the key from Vault at call time (instead of the hardcoded anon key) and pass it as the Bearer.
3. Add `RAISE LOG` (not just `WARNING`) on dispatch so future failures are visible.
4. Backfill the two stuck rows: re-touch them (`update ai_knowledge set updated_at=now() where embedding is null and is_active`) so the trigger re-fires with the correct key.

Why Vault and not env: triggers can't read edge-function env; Vault is the standard Supabase pattern for server-side secrets in SQL.

### B. Add a manual "Re-embed" escape hatch in the UI (`AIBrainTab.tsx`)

- In the row-action menu (pencil column), add **"Re-embed now"** for any row with `embedding IS NULL`.
- It calls `embed-knowledge` via `supabase.functions.invoke` (which uses the user's session JWT → fine, but the edge fn must also accept owner/admin JWTs).
- Update `embed-knowledge` auth gate to allow EITHER `bearer === SERVICE_ROLE` OR a verified owner/admin user JWT. Trigger path stays service-role; admin click stays user-JWT.

### C. UI polish on the knowledge table (Vuexy)

- Replace "Embed failed" plain badge with `bg-red-100 text-red-700 rounded-full` + AlertCircle icon + a tooltip explaining "Last embed attempt: 401 from embed-knowledge. Click Re-embed."
- Add a "Rule" vs "Persona" pill next to the topic so the 3-row architecture is self-documenting.

## Files Touched

**Migration**
- `supabase/migrations/<ts>_fix_embed_trigger_auth.sql` — Vault secret read, rewritten trigger, backfill UPDATE.

**Edge function**
- `supabase/functions/embed-knowledge/index.ts` — accept service-role OR owner/admin user JWT.

**Frontend**
- `src/components/settings/AIBrainTab.tsx` — "Re-embed now" action, role/rule pill, improved failure tooltip.

## Verification
1. Run migration → both `pricing_rules` and `booking_rules` rows show `Ready` within ~10s.
2. `select id, embedding is null from ai_knowledge where is_active` → all false.
3. Click "Re-embed now" on any row as owner → toast success, badge flips to Ready.
4. Send "what's the price?" via WhatsApp → reply contains Founder's Waitlist pivot (proves the pricing rule reached the LLM via RAG).

## Out of Scope
- No changes to the 3-row data model.
- No changes to `ai-prompt.ts` retrieval or `match_ai_knowledge` RPC.
- No changes to Ananya's persona content.
