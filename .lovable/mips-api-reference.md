# MIPS API Reference — RuoYi-Vue v3 (Smart Pass / Tendcent)

## Server

All API calls go through per-branch `mips_connections` table. Fallback: env vars `MIPS_SERVER_URL`, `MIPS_USERNAME`, `MIPS_PASSWORD`.

```
Default Base URL: http://212.38.94.228:9000
```

> **IMPORTANT**: Server URL is configurable per branch via Settings → Integrations or Device Command Center → MIPS Server Connection card.

---

## Authentication

```
POST /login
Content-Type: application/json
TENANT-ID: 1

Request:
{
  "username": "admin",
  "password": "admin123"
}

Response:
{
  "code": 200,
  "msg": "操作成功",
  "token": "eyJhbGciOi..."
}
```

**All subsequent requests require:**
```
Authorization: Bearer <token>
TENANT-ID: 1
Content-Type: application/json
```

---

## Device Endpoints

### List All Devices
```
GET /through/device/list
```

### Remote Open Door
```
GET /through/device/openDoor/{deviceId}
```

### Reboot Device
```
GET /through/device/reboot/{deviceId}
```

### Sync Person to Device (Personnel Issue)
```
POST /through/device/syncPerson
{
  "personId": 2,
  "deviceIds": [13],
  "deviceNumType": "4"
}
```
**CRITICAL: `deviceNumType: "4"` is REQUIRED.**
**Supports multi-device: `deviceIds: [13, 14, 15]` dispatches to all devices at once.**

---

## Person Endpoints

### List Persons
```
GET /personInfo/person/list?personSn=MAIN00001&pageNum=1&pageSize=10
```

### Create Person (POST returns NO personId — must lookup after)
```
POST /personInfo/person
```

### Update Person (PUT requires FULL object for photoUri to persist)
```
PUT /personInfo/person
```
**IMPORTANT:** Partial PUT (e.g. just `{personId, photoUri}`) will NOT persist `photoUri`. You must send the complete person object from GET, with modified fields merged in.

### Delete Person
```
DELETE /personInfo/person/{personId}
```

---

## Photo Upload (Two-Step Flow)

### Rules (from manual)
- **Only JPG format** supported
- **Max 400KB** per portrait file
- Upload always uses `image/jpeg` content-type and `.jpg` extension

### Step 1: Upload file
```
POST /common/uploadHeadPhoto
Content-Type: multipart/form-data
Body: file=<jpeg, max 400KB>

Response:
{
  "code": 200,
  "fileName": "/userfiles/headPhoto/2026-03/photo_20260326150625A017.jpg",
  "url": "/userfiles/headPhoto/2026-03/photo_20260326150625A017.jpg",
  "originalFilename": "photo.jpg"
}
```

### Step 2: Assign photo to person (FULL PUT required)
```
PUT /personInfo/person
Body: { ...fullPersonObject, "photoUri": "/userfiles/headPhoto/2026-03/photo.jpg" }
```

**NOTE:** `POST /personInfo/person/importPhoto` does NOT work (returns 405).

---

## Callback / Webhook URLs

### Architecture: Primary Relay Pattern
```
Device → MIPS Middleware (HTTP) → Our Webhook (HTTPS) → Log + Attendance → Relay back to MIPS
```

The physical device only supports HTTP. It sends callbacks to the MIPS middleware server. The MIPS middleware then forwards to our Supabase Edge Function webhook (HTTPS).

### MIPS Admin Panel Configuration
Location: **Device Management → Configure Device → Server Configuration tab**

| Field | Value |
|---|---|
| **Recognition Record Upload URL** | `https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-webhook-receiver` |
| **Register Person Data Upload URL** | `https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-webhook-receiver` |
| **Device Heartbeat Upload URL** | Keep default (MIPS loopback) |

### Known Callback Paths (MIPS internal, version-dependent)
| Version | Attendance Callback | Heartbeat | Photo Registration |
|---|---|---|---|
| Standard v3 | `/api/callback/identify` | `/api/callback/heartbeat` | `/api/callback/imgReg` |
| TDX Admin v3 | `/tdx-admin/api/callback/identity` | `/tdx-admin/api/callback/heartbeat` | `/tdx-admin/api/callback/imgReg` |

Our relay tries both paths for compatibility.

### Actual Device Payload (Face Scan)
The device sends `personId` (which is the `personSn` code used during sync, NOT the numeric MIPS ID):
```json
{
  "personId": "EMPMM3FYN8U",
  "personName": "MANAGER",
  "type": "face_0",
  "time": "1774594588284",
  "deviceKey": "D1146D682A96B1C2",
  "deviceName": "Front-Door-Device",
  "searchScore": "0.95",
  "livenessScore": "0.98",
  "imgUri": "/path/to/capture.jpg",
  "temperature": "36.5"
}
```

### Timestamp Formats
- `time`: Unix milliseconds (13 digits, e.g. `1774594588284`)
- `createTime`: ISO string or `YYYY-MM-DD HH:mm:ss`
- `normalizeScanTime()` handles: seconds (10 digits), milliseconds (13), microseconds (16), nanoseconds (19), ISO strings

### Required Response
```json
{"result": 1, "code": "000"}
```

### Pass Types
- `face_0` — Authorized face scan (check-in)
- `face_1` — Outside allowed passtime (denied)
- `face_2` — Stranger / unrecognized

---

## Person Lookup Chain (Webhook)

When a device sends a face scan, the webhook resolves the person using a 3-tier lookup:

```
Tier 1: mips_person_sn = personId  (exact match, fastest)
Tier 2: mips_person_id = personId  (numeric MIPS ID)
Tier 3: Code normalization:
  - member_code (with hyphen re-insertion: MAIN00001 → MAIN-00001)
  - employee_code (with EMP prefix: EMPMM3FYN8U → EMP-MM3FYN8U)
  - trainers.mips_person_id (TRN prefix: TRN5096)
```

### Key Fields
| CRM Column | Purpose |
|---|---|
| `mips_person_sn` | The `personSn` sent to MIPS during sync (hyphen-stripped code). Written by `sync-to-mips`. |
| `mips_person_id` | The numeric MIPS `personId` returned after creation. Written by `sync-to-mips`. |
| `mips_sync_status` | `synced`, `failed`, or `pending`. |

---

## Attendance Processing Architecture

```
┌──────────────┐     ┌────────────────────┐     ┌────────────────────┐
│ Face Terminal │────▶│ mips-webhook-       │────▶│ Database           │
│ (Hardware)    │     │ receiver            │     │                    │
└──────────────┘     │                     │     │ access_logs        │
                     │ 1. Parse payload    │     │ member_attendance  │
                     │ 2. normalizeScanTime│     │ staff_attendance   │
                     │ 3. Lookup person    │     └────────────────────┘
                     │    (3-tier chain)   │
                     │ 4. Route by type:   │
                     │   member → RPC      │
                     │   employee → toggle │
                     │   trainer → toggle  │
                     │ 5. Log access_logs  │
                     │ 6. Relay to MIPS    │
                     └────────────────────┘
```

| Role | Table | Key Field | Check-in Method | Used By |
|---|---|---|---|---|
| Member | `member_attendance` | `member_id` | `member_check_in` RPC (validates membership) | My Attendance, Attendance Dashboard, Analytics |
| Employee | `staff_attendance` | `user_id` | Direct insert (toggle check-in/out same day) | HRM Payroll, Staff Attendance page |
| Trainer | `staff_attendance` | `user_id` | Direct insert (toggle check-in/out same day) | HRM Payroll, Staff Attendance, Trainer Earnings |
| Admin/Manager | `staff_attendance` | `user_id` | Direct insert (toggle check-in/out same day) | HRM Payroll, Staff Attendance page |

### Member Check-in Flow
1. `member_check_in` RPC validates: active membership, correct branch, not already checked in
2. Inserts into `member_attendance` with `check_in_method: "biometric"`
3. Returns validation result (or denial reason)

### Staff/Trainer Check-in Flow
1. Query `staff_attendance` for today, same `user_id`, where `check_out IS NULL`
2. If found → UPDATE `check_out` (check-out)
3. If not found → INSERT new row (check-in)

### HRM/Payroll Integration
```
Payroll = (Base Salary / Calendar Days × Days Present) + PT Commissions − 12% PF
```
`calculatePayrollForStaff()` queries `staff_attendance` by `user_id` for the month → counts `daysPresent`.

---

## CRM → MIPS Field Mapping

| CRM Field | MIPS Field | Notes |
|---|---|---|
| `member_code` (hyphen-stripped) | `personSn` | `MAIN-00001` → `MAIN00001` |
| `employee_code` (hyphen-stripped) | `personSn` | `EMP-MM3FYN8U` → `EMPMM3FYN8U` |
| `TRN-{first4chars}` (hyphen-stripped) | `personSn` | `TRN-5096` → `TRN5096` |
| `profiles.full_name` | `name` | |
| `profiles.phone` | `mobile` | NOT `phone` |
| `profiles.email` | `email` | |
| `membership.start_date` | `validTimeBegin` | Members only |
| `membership.end_date` | `validTimeEnd` | Members only; staff/trainers = `2099-12-31 23:59:59` |
| (hardcoded) | `personType` | Always `1` (Personnel). **Never `2` — `2` = Visitor and files the person under Visitor Management.** |
| Everyone | `deptId` | `100` (Incline). The server only has departments `100 Incline` and `103 Visitors`; `101`/`102` do NOT exist. |
| (hardcoded) | `attendance` | Always `"1"` |
| (hardcoded) | `holiday` | Always `"1"` |

## Validity Rules

- **Members**: `validTimeBegin` = membership start, `validTimeEnd` = membership end
- **Employees/Trainers/Admins**: `validTimeEnd` = `2099-12-31 23:59:59` (permanent until deactivated)

---

## Per-Branch Connection Model

Connections stored in `mips_connections` table:

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `branch_id` | uuid | FK to branches |
| `server_url` | text | e.g. `http://212.38.94.228:9000` |
| `username` | text | MIPS admin username |
| `password` | text | MIPS admin password |
| `is_active` | boolean | Enable/disable |

All edge functions (`mips-proxy`, `sync-to-mips`, `mips-webhook-receiver`) resolve server URL from this table first, falling back to env vars.

---

## Edge Function Architecture

| Function | Purpose |
|---|---|
| `mips-proxy` | Generic proxy to RuoYi API (branch-aware) |
| `sync-to-mips` | Upsert person + photo + multi-device dispatch. Writes `mips_person_id` AND `mips_person_sn` to CRM. |
| `mips-webhook-receiver` | Receive device callbacks → 3-tier person lookup → attendance by role → access_log → relay to MIPS |

---

## Important Notes

1. **Success detection**: Always check `json.code === 200 || json.code === 0`. NEVER use `response.ok`.
2. **POST /personInfo/person returns NO personId** — must GET by personSn after create.
3. **PUT requires full object** — partial PUT drops fields like photoUri.
4. **Photo upload is two-step**: upload file → PUT photoUri on full person record.
5. **deviceNumType: "4"** is REQUIRED for syncPerson.
6. **personSn** not personNo; **mobile** not phone.
7. **Photo must be JPG and under 400KB**.
8. **Multi-device dispatch**: `deviceIds` supports arrays for simultaneous sync to multiple devices.
9. **Device is HTTP-only**: Cannot reach HTTPS endpoints directly. Use MIPS middleware as relay.
10. **Reboot endpoint**: `/through/device/reboot/{id}` (NOT `/restart`).
11. **Device sends `personId` = `personSn`**: The device payload uses `personId` field but the value is the `personSn` code, NOT the numeric MIPS ID.
12. **Timestamps from device**: `time` field is Unix milliseconds (13 digits). `normalizeScanTime()` handles all formats.
13. **`mips_person_sn` column**: Added to `members`, `employees`, `trainers` tables. Stores the exact `personSn` sent to MIPS during sync for reliable webhook lookups.

---

## Hardware Access Revocation (Edge Authorization Fix)

### Problem
The turnstile makes **local** door-open decisions based on synced `validTimeEnd`. If a member is frozen/expired in the CRM but their hardware profile isn't updated, the gate still opens.

### Solution: `revoke-mips-access` Edge Function

```
POST /functions/v1/revoke-mips-access
{
  "member_id": "uuid",
  "action": "revoke" | "restore",
  "reason": "Membership frozen",
  "branch_id": "uuid" (optional)
}
```

**Revoke**: Sets `validTimeEnd` to `2000-01-01 00:00:00` → dispatches to devices → hardware blocks access immediately.
**Restore**: Sets `validTimeEnd` to active membership `end_date` → dispatches to devices → hardware allows access.

### Automatic Triggers

| Event | Action | Triggered By |
|---|---|---|
| Quick Freeze | Revoke (`2000-01-01`) | `QuickFreezeDrawer` → `revokeHardwareAccess()` |
| Freeze approved | Revoke (`2000-01-01`) | `ApprovalRequestsDrawer` → `revokeHardwareAccess()` |
| Unfreeze | Restore (new `end_date`) | `UnfreezeMembershipDrawer` → `restoreHardwareAccess()` |
| Cancel membership | Revoke (`2000-01-01`) | `CancelMembershipDrawer` → `revokeHardwareAccess()` |
| Membership expired | Revoke | `check-expired-access` edge function (batch) |
| Overdue invoice | Revoke | `check-expired-access` edge function (batch) |
| New purchase + sync | Restore | `sync-to-mips` (sets membership `end_date`) |

### `check-expired-access` Edge Function (Batch Revocation)

Scans three categories:
1. Members with `hardware_access_status = 'active'` but no valid membership
2. Frozen memberships with active hardware
3. Members with overdue invoices and active hardware

### Member `hardware_access_status` Column

| Value | Meaning |
|---|---|
| `none` | Never synced to hardware |
| `active` | Hardware access granted |
| `revoked` | Hardware access revoked |

---

## Exterior API (from Postman Collection)

Alternative API paths discovered in MIPS middleware. Currently unused but documented for reference:

| Endpoint | Method | Purpose |
|---|---|---|
| `/interface/exterior/login` | POST | Alternative auth |
| `/interface/exterior/getPersonList` | GET | List persons |
| `/interface/exterior/addPerson` | POST | Add person |
| `/interface/exterior/updatePerson` | POST | Update person |
| `/interface/exterior/getCheckRecordList` | GET | Attendance records |
| `/interface/exterior/listDeptNew` | GET | List departments |
| `/interface/exterior/addDept` | POST | Add department |
| `/interface/exterior/getPost` | GET | List positions |
| `/interface/exterior/addPost` | POST | Add position |
