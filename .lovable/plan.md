## Audit summary

### 1. WhatsApp 131049 ("not delivered to maintain healthy ecosystem engagement")

**Reality check first:** There is no separate "Marketing API" that bypasses 131049. All WhatsApp business messaging (Cloud API, On-Premise, BSP, and the newer "Marketing Messages Lite API") funnels through the same Meta pacing engine. 131049 fires when Meta judges the *recipient* is over-messaged or unlikely to engage — the API endpoint doesn't change the verdict. What actually reduces 131049:

- Sending MARKETING templates only to users who opted in and engaged recently
- Using a high-quality-rated template (Meta quality tier)
- Falling back to another channel (RCS/SMS) when Meta paces
- Correct category on the template (misclassified UTILITY→MARKETING gets paced hardest)

We already have the pacing cooldown + category-drift warning in `dispatch-communication` (v1.14+) and the humanised error in `metaErrorLabels.ts`. The real gap is UX: the campaign wizard doesn't tell the user "this will use WhatsApp MARKETING category which is subject to pacing" and doesn't offer an automatic RCS/SMS fallback per recipient.

**Plan (issue 1):**
- Campaign Wizard "Promotion" type → add an inline advisory + a toggle **"Auto-fallback to RCS/SMS on Meta pacing (131049/130472)"** (default ON). Persist to `campaigns.fallback_policy`.
- `send-broadcast` → when dispatcher returns `meta_code in (131049,130472)` and fallback_policy is on, immediately re-dispatch that single recipient via `channel:'rcs'` (which itself falls back to SMS for freeform per existing rule). Log both attempts in `campaign_recipients` with `fallback_used=true`.
- Campaign Detail Drawer → surface a new "Paced by Meta → fallback sent via RCS/SMS" row so the operator sees exactly what happened.
- Add a short KB entry on the Promotion step explaining why 131049 happens and that swapping APIs won't fix it, so the user stops chasing that assumption.

*Out of scope:* enrolling in Meta's Marketing Messages Lite API — it requires a separate Meta application, is invite-only in India, and would not eliminate 131049.

---

### 2. Dual facial-terminal sync (two devices, both directions)

**Current state:** `sync-to-mips` already dispatches a person to *all* `mips_device_id`s found for the branch in one `syncPerson` call (see `supabase/functions/sync-to-mips/index.ts` L243-306), and `mips-access` does the same for permission grants. So new enrolments *do* land on both devices — provided both devices have `is_online=true` and a non-null `mips_device_id` in `access_devices`.

**Real gaps observed:**
- Nothing reconciles when device B was offline at enrolment time — that person never lands on B.
- Deletions/photo re-enrolments only re-push the row that changed; if a device was down we never retry.
- There is no "both-ways" view: staff can't see per-device presence for a single member.

**Plan (issue 2):**
- New edge fn **`mips-reconcile-devices`** (cron every 15 min): for each branch with ≥2 devices, list persons on each device via `/through/person/list`, diff against `members`+`employees` scoped to that branch, and re-issue `syncPerson` for any missing pairing. Writes to `mips_sync_failures` on hard errors.
- New Personnel Sync UI column **"Devices"** showing green/red pill per device SN so ops can spot drift instantly, plus a **"Re-sync to all devices"** row action that calls `assignDevicePermission(personMipsId, allDeviceIds)`.
- `syncPersonToMIPS` service call: change from single `targetDeviceId` to *all* online device IDs in that branch (currently sends only one when called from PersonnelSyncTab).
- Migration: add `access_devices.last_reconcile_at timestamptz` for observability.

---

### 3. Override Entry on `/attendance-dashboard` — which device, and why slow?

**Current behaviour** (`remoteOpenDoorByBranch` in `src/services/mipsService.ts` L233-262):
1. Queries `access_devices` filtered by branch + `is_online=true`
2. Picks the *first* row that has a `mips_device_id` — non-deterministic when two devices exist
3. Falls back to the first online device in the raw MIPS list otherwise
4. Issues a single MIPS proxy GET to `/through/device/openDoor/{id}`

So today it opens whichever of Device 1 / Device 2 the DB returns first — usually the entry device, but not guaranteed. The latency is the round-trip *localhost MIPS server → device → local relay → callback*, which is bounded by MIPS's own polling window (~2-4 s) plus edge-fn cold start.

**Plan (issue 3):**
- Add a nullable enum column `access_devices.door_role text check (door_role in ('entry','exit','both')) default 'both'` (migration).
- Device Management → device edit sheet → Role selector (Entry / Exit / Both).
- `remoteOpenDoorByBranch(branchId, { role = 'entry' })`:
  - Prefer devices where `door_role IN ('entry','both')` and `is_online=true`.
  - If multiple match, fire `openDoor` **in parallel to all** and resolve on first success (so it opens whichever terminal the person is standing at). This also removes the "which one is it opening" ambiguity — both entry-role doors will click.
  - Return per-device outcome to the UI.
- Override Entry button: replace the single toast with an inline mini-panel that lists each device attempted with a green tick / red cross + latency in ms, so the operator sees "Entry-01 opened in 1.2 s, Entry-02 timeout".
- Warm the `mips-proxy` edge fn via a lightweight ping when the Attendance Dashboard mounts to shave ~800 ms off first-click cold start.

---

## Technical layout

```text
src/
  pages/
    AttendanceDashboard.tsx          # richer override-entry result panel + warm-ping on mount
    DeviceManagement.tsx             # door_role selector, per-device presence pill
  components/campaigns/
    CampaignWizard.tsx               # 131049 advisory + fallback toggle on Promotion
    CampaignDetailDrawer.tsx         # show fallback_used per recipient
  components/devices/
    PersonnelSyncTab.tsx             # per-device presence + "Re-sync to all devices"
  services/
    mipsService.ts                   # remoteOpenDoorByBranch(role, parallel), syncPersonToMIPS→all devices

supabase/functions/
  send-broadcast/index.ts            # honour campaigns.fallback_policy on 131049/130472
  mips-reconcile-devices/index.ts    # NEW cron — diff+repair per branch
  sync-to-mips/index.ts              # unchanged (already multi-device); add reconcile hook

supabase/migrations/
  <ts>_door_role_and_fallback_policy.sql
    ALTER TABLE access_devices ADD COLUMN door_role text …;
    ALTER TABLE access_devices ADD COLUMN last_reconcile_at timestamptz;
    ALTER TABLE campaigns ADD COLUMN fallback_policy jsonb DEFAULT '{"on_pacing":true}'::jsonb;
```

Cron: `mips-reconcile-devices` every 15 min via existing `automation-brain-tick` rule (no new pg_cron entry).

## Verification

1. Fire a MARKETING campaign to a phone previously paced → expect immediate RCS/SMS fallback row visible in Campaign Detail.
2. Take Device 2 offline, enrol a new member, bring Device 2 online, wait ≤15 min → member appears on Device 2 (verified via `/through/person/list`).
3. Click Override Entry with two entry-role devices → both click, panel shows both latencies.
4. Set Device 2 role to Exit → Override Entry only opens Device 1.

## Out of scope

- Migrating to Meta's Marketing Messages Lite API (invite-only, wouldn't remove 131049).
- Rebuilding the MIPS tunnel/latency stack.
- Any Live Feed / campaign stats work beyond adding the fallback column.
