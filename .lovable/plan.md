
## What's actually wrong (verified against live data)

I queried the 9 members from your screenshot. The database is correct — **all of them are already `status='active'` on both `members` and `memberships`** (only Sandeep is legitimately pending, plan starts 01 Dec 2026). The UI is wrong.

Root cause: `src/pages/Members.tsx` line 177 forces the badge to "Pending Plan" whenever `members.lifecycle_state = 'pending_plan'`, regardless of the membership status. When yesterday's `activate_scheduled_memberships` cron flipped `memberships.status` from `pending` → `active`, it never cleared the parent member's `lifecycle_state`. So the row is active in every table, but the sticky lifecycle flag keeps painting it amber.

Verified rows (excerpt):

```
INC-26-0007 KAUSHAY JAIN   member.status=active   lifecycle_state=pending_plan   plan=active  start=2026-07-27
INC-26-0016 Syed Nida Ali  member.status=active   lifecycle_state=pending_plan   plan=active  start=2026-07-27
INC-26-0018 Bhavesh D.     member.status=active   lifecycle_state=pending_plan   plan=active  start=2026-07-27
```

Second issue you raised: uploading a member photo currently updates `members.biometric_photo_url` (and now, after last turn, mirrors it to `profiles.avatar_url`), but **nothing calls `sync-to-mips` automatically** — so the face never reaches the turnstile until someone clicks "Sync" manually in the Device Center.

## Fix plan (opening-day safe)

### 1. Clear the sticky `pending_plan` flag (immediate + permanent)

**Backfill (runs once, opens the gym):**

```sql
UPDATE public.members mem
   SET lifecycle_state = 'active', updated_at = now()
 WHERE lifecycle_state = 'pending_plan'
   AND EXISTS (
     SELECT 1 FROM public.memberships m
      WHERE m.member_id = mem.id
        AND m.status = 'active'
        AND m.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   );
```

**Permanent — patch `activate_scheduled_memberships`** so every future IST-midnight activation also lifts the member out of `pending_plan` in the same transaction:

```sql
UPDATE public.members
   SET lifecycle_state = 'active', updated_at = now()
 WHERE id = v_row.member_id
   AND lifecycle_state IN ('pending_plan','pending');
```

Plus a small DB trigger `tg_clear_pending_plan_on_membership_active` on `memberships` UPDATE: whenever a row transitions to `status='active'`, clear the parent member's `pending_plan` state — so manual activations, membership transfers, and edge-function activations all self-heal.

### 2. Auto-sync face to MIPS on photo upload

Add a lightweight DB trigger on `public.members` (AFTER UPDATE OF `biometric_photo_url`) that uses `pg_net` to POST to the existing `sync-to-mips` edge function with `{ personType: 'member', personId: NEW.id, action: 'upsert' }`. Same trigger pattern on `public.employees` and `public.trainers` so trainers/staff faces are pushed the moment a photo lands.

Guardrails:
- Fires only when `biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url` and the new value is not null.
- Also skips fire if `hardware_access_enabled = false` (respects the existing opt-out).
- Records the request_id on `biometric_sync_queue` so the Device Center's "Personnel Sync" tab shows a live "Syncing…" row.

### 3. UI belt-and-braces

In `src/pages/Members.tsx` the derivation is changed so an active membership wins over a stale `pending_plan` flag:

```ts
if (activeMembership) memberStatus = 'active';
else if (m.lifecycle_state === 'pending_plan') memberStatus = 'pending_plan';
else if (scheduledMembership) memberStatus = 'scheduled';
```

This makes the list correct even if the DB flag is momentarily stale (e.g. during the couple-second gap between purchase RPC and lifecycle trigger).

### 4. Verification before you open the doors

After the migration runs I'll re-query all 9 members and confirm:
- Every row shows `lifecycle_state='active'`, `member_status='active'`, `plan_status='active'`.
- `days_left` still matches (179d / 364d as in your screenshot).
- Sandeep remains legitimately `scheduled` with "Starts 01 Dec 2026".

Then I'll pick one member with a photo (e.g. Kaushay), toggle a re-upload, and confirm a fresh row lands on `biometric_sync_queue` with `status='queued'` → `synced` within seconds.

## Files touched

- **DB migration** — `activate_scheduled_memberships` patch, backfill UPDATE, `tg_clear_pending_plan_on_membership_active` trigger, `tg_push_photo_to_mips` trigger (members/employees/trainers).
- `src/pages/Members.tsx` — reorder the status derivation so active plans win.

Nothing else changes. `sync-to-mips` edge fn already accepts the payload we're sending — no code change there.
