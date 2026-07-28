## Goal

Two fixes in the Device Command Center:

1. **Live Access Feed** — poll MIPS server directly for face-scan records (via `/through/record/list`) so attendance shows even when the webhook to Supabase is misconfigured or blocked. Merge with existing `access_logs` for a single unified feed.
2. **Personnel Sync KPIs** — correct the counters. Current tiles show wrong numbers because:
   - **"No Photo 20"** — the `hasPhoto` check only looks at `biometric_photo_url` and `profiles.avatar_url`. It ignores the newer private-bucket field `biometric_photo_path`, which is where recent uploads land. Result: members who *do* have photos are counted as "No Photo".
   - **"Staff & Trainers 6/8"** — the mismatch is real (2 not synced), but there is no visibility on *why* (missing photo? failed? unmapped?), and revoked/offboarded people are silently excluded from the denominator making the fraction hard to reason about.

Both are frontend/service changes only — no schema, no policy work.

---

## Changes

### 1. `src/services/mipsService.ts` — expand pass-record fetch

- Extend `fetchMIPSPassRecords()` to accept optional filters (`beginTime`, `endTime`, `personName`, `deviceId`) and always pass `branchId`.
- Add `fetchRecentMIPSPassRecords(branchId, limit=30)` — thin helper that pulls the latest N records across all devices for a branch.

### 2. `src/components/devices/LiveAccessLog.tsx` — hybrid feed

- Add a second TanStack Query alongside the existing `access_logs` query:
  - `queryKey: ['mips-pass-records', branchId]`
  - Calls `fetchRecentMIPSPassRecords(branchId, limit)` every 15 s (polling), disabled if no `branchId`.
  - Maps each MIPS row `{ personNo, personName, deviceName, createTime, imgUri, passType }` into the same `AccessLogEntry` shape (synthetic `id = 'mips:'+record.id`, `result` derived from `passPersonType` → `member` / `staff` / `stranger`).
- Merge both streams (dedupe by `personNo + createTime` within 60 s, prefer the DB row when both exist), then sort by timestamp desc, keep top `limit`.
- Add a small provenance chip next to each row: **"Live from MIPS"** vs **"Webhook"** so ops can see which pipe delivered the event.
- Keep the realtime `postgres_changes` subscription for instant webhook events.
- If the MIPS poll fails, silently fall back to `access_logs` only and switch the header chip to a subdued "MIPS unreachable" tooltip (does not break the feed).

### 3. `src/components/devices/PersonnelSyncTab.tsx` — correct the tiles

- In the personnel query, also select `biometric_photo_path` for members, employees, trainers.
- Update the `hasPhoto` calculation:
  ```
  hasPhoto = !!(biometric_photo_path || biometric_photo_url || avatar || lead.avatar_url)
  ```
  (path is authoritative for the private bucket; URL fields are the legacy public fallback.)
- Recompute the KPI tiles from the corrected data:
  - **Members**: `synced / total`
  - **Staff & Trainers**: `synced / total` (unchanged formula, only accurate once `hasPhoto` is fixed)
  - **Total Synced**: unchanged
  - **Pending**: people with `mipsSyncStatus !== 'synced'` AND `hasPhoto === true` (i.e. actually syncable)
  - **No Photo**: `!hasPhoto` only — this number will drop dramatically once the path field is included
- Add a tiny helper tooltip on each tile explaining what it counts (so "2 pending" vs "20 no photo" is self-explanatory).

### 4. Verification

- `curl` the MIPS `/through/record/list` via the `mips-proxy` edge function with the current branch to confirm we get rows back and that `personNo` matches the `member_code`-stripped format we already use for lookup.
- Load `/devices` in a headless browser, screenshot the Personnel Sync tab, and confirm "No Photo" drops to the real count and the Live Feed shows a "Live from MIPS" entry.

---

## Out of scope

- No changes to `mips-webhook-receiver`, `sync-to-mips`, `process-biometric-sync-queue`, database schema, or RLS.
- No new edge functions — MIPS polling reuses the existing `mips-proxy`.
- Device configuration (Recognition/Register URLs on the MIPS panel) is unchanged; this plan makes the app resilient to a misconfigured webhook, it does not replace the webhook path.
