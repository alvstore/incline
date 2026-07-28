## Root causes (verified)

**A. Live attendance broken** — `mips-webhook-receiver` logs (every 10s, last hour) show:
```
ERROR mips-webhook-receiver: MIPS_WEBHOOK_SECRET is not configured — refusing all requests
```
The v2.0.0 receiver requires `MIPS_WEBHOOK_SECRET`. It is not set, so every callback from the MIPS server (recognition records, heartbeat, register-person) is refused with 401 → no attendance rows, no live feed.

**B. Wrong URLs pointed at us in Device Configuration** (your screenshot)
The MIPS server exposes 5 "server configuration" URLs. Only ONE is meant to hit our Supabase edge function:

| Field | Correct value | You set it to |
|---|---|---|
| Recognition Record Upload URL | `…/functions/v1/mips-webhook-receiver` ✅ | ours ✅ |
| Device Heartbeat Upload URL | MIPS internal (`http://<mips>/api/callback/heartbeat`) | MIPS internal ✅ |
| **Register Person Data Upload URL** | **MIPS internal (`http://<mips>/through/api/person/reg`)** | **ours ❌** |
| Register Fingerprint Data Upload URL | MIPS internal | MIPS internal ✅ |
| Alarm Data Upload URL | MIPS internal | MIPS internal ✅ |

The "Register Person Data Upload URL" is the endpoint the *device* posts to when a person is enrolled on-device — it must stay inside MIPS. Pointing it at our webhook breaks MIPS's own person/photo registration pipeline (which is why Kirti INC-26-0015 got a person ID `82` but no face record on the device, and Rehan/Mohit are missing entirely from the device even though our DB says `mips_sync_status=synced`).

**C. Photo queue is stuck at 16 failed / 0 pending**
- All three members (`Rehan`, `Mohit`, `Kirti`) have `photo_upload` queue rows with `retry_count=5`, `status='failed'`, error = `Edge Function returned a non-2xx status code`.
- `process-biometric-sync-queue` filters `retry_count < 5`, so failed rows are never retried automatically.
- Their `biometric_photo_url` in the DB still points at a **public `avatars/…` URL** (not the private `member-photos` bucket). `sync-to-mips` `uploadPhoto()` fetches this URL server-side; the 400s we've been seeing on `/avatars/` uploads suggest the fetch or the >400KB size check is failing → non-2xx bubble up.

**D. Consequence chain confirmed**
- Kirti has `biometric_photo_path=biometric/members/8bbaf3e9…jpg` set, but `biometric_photo_url` still holds the OLD public avatar URL → mirror trigger isn't updating it, so `sync-to-mips` uses the wrong URL.
- Rehan has no `biometric_photo_path` at all — only the public avatar URL.

---

## Fix plan

### 1. Restore correct MIPS device URLs (manual — on the MIPS admin UI at `http://212.38.94.228:9000`)
Set exactly these 5 URLs on **every** device (`Device Management → Configure → Server Configuration`):
```
Recognition Record Upload URL   → https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-webhook-receiver
Device Heartbeat Upload URL     → http://212.38.94.228:9000/api/callback/heartbeat
Register Person Data Upload URL → http://212.38.94.228:9000/through/api/person/reg
Register Fingerprint Data URL   → http://212.38.94.228:9000/through/api/finger/reg
Alarm Data Upload URL           → http://212.38.94.228:9000/through/api/alarm/reg
```
Only the first one goes to us. Everything else stays inside MIPS.

### 2. Configure the webhook secret (backend)
- Provision `MIPS_WEBHOOK_SECRET` (random 32-byte token) via `secrets` tool.
- Add it to the MIPS server callback header (in MIPS custom-header config) so the receiver accepts inbound calls.
- Verify: hit `mips-webhook-receiver` with `curl` — with the header should return `{result:1,code:"000"}`, without it should 401.

### 3. Heal the biometric photo pipeline
a. **Backfill `biometric_photo_url` from `biometric_photo_path`** for all members where `biometric_photo_path IS NOT NULL` — write it as a signed URL (or store just the path and let `sync-to-mips` sign it, which it already does via `resolveBiometricPhoto`). Fix the mirror trigger so it stops overwriting `biometric_photo_url` with the public avatar URL.

b. **Reset the 16 `failed` queue rows** back to `pending` with `retry_count=0`.

c. **Change `process-biometric-sync-queue`**:
   - Include `status='failed'` rows older than 15 min in the drain, up to a hard-cap (e.g. 10 retries) with exponential backoff.
   - Log every invocation result (currently silent — no logs at all).

d. **`sync-to-mips` `uploadPhoto()`**: when the resolved photo URL is a Supabase public URL and fetch fails, fall through to `avatar_storage_path`/`biometric_photo_path` signed URLs instead of failing.

### 4. Reset the three members and re-sync (curl-tested)
For Rehan, Mohit, Kirti:
- Ensure `biometric_photo_path` is populated (upload from admin avatar if missing).
- Invoke `sync-to-mips` with `{person_type:'member', person_id, server_only:true}` and confirm `photo_result.success=true` in the response.
- Then invoke `mips-reconcile-devices` to fan out to both terminals.

### 5. Add operator UI safeguards
- On **Personnel Sync** tab: add a "Reset failed" bulk action next to "Heal Queue" that flips `failed → pending, retry_count=0`.
- On **MIPS Dashboard**: surface a red banner when `mips-webhook-receiver` is refusing calls (poll `error_logs` for `source='mips_webhook'` with the "secret not configured" fingerprint).

---

## Technical notes

- Files to touch (build phase):
  - `supabase/functions/process-biometric-sync-queue/index.ts` (backoff + failed retry + logs)
  - `supabase/functions/sync-to-mips/index.ts` (`uploadPhoto` fallback chain)
  - `src/components/devices/PersonnelSyncTab.tsx` (Reset failed button)
  - `src/components/devices/MIPSDashboard.tsx` (webhook-refusal banner)
- Migration: reset failed queue rows + one-shot backfill of `biometric_photo_url` from `biometric_photo_path` for the three members (and any others with the same drift).
- Secret: `MIPS_WEBHOOK_SECRET` via secrets tool. Do **not** commit it.
- No RLS or table shape changes.

I've verified everything above via `edge_function_logs`, `read_query` on `members` + `biometric_sync_queue`, and code reads of the three edge functions. Ready to implement on approval.