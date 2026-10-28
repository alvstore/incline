# Incline — Rise.Reflect.Repeat.

Multi-branch fitness and recovery operations and member self-service for The Incline Life by Incline, Udaipur, Rajasthan. Canonical website: https://theincline.in/.

## Project map

| Location | Purpose |
| --- | --- |
| `src/` | Web application, design system and shared domain logic |
| `public/` | Served assets, crawler files and referenced 3D models |
| `supabase/functions/` | Backend functions and shared helpers |
| `supabase/migrations/`, `drizzle/` | Historical and managed database migrations — preserve applied history |
| `scripts/`, `scripts/tests/` | Active maintenance, QA and regression suites |
| `docs/` | Project guides, the consolidated Flutter guide and historical notes |
| `AGENTS.md` | Engineering rules; also read nested guidance before scoped edits |
| `roadmap.md` | Progress and outstanding dependencies |

Build configuration and lockfiles stay at the root in conventional locations. Tool-managed metadata and approved skills are not application clutter. Browser captures and scratch helpers belong outside the checkout under `/tmp/`.

See [the documentation index](docs/README.md). The Flutter guide covers shared-backend contracts and explicitly identifies native/shared-PDF prerequisites, not a shipped Flutter app.

## Local development

Prerequisites:

- Maintained Node.js 22-compatible runtime (CI provisions Node 22; sandbox runtime is managed separately)
- Bun (the project's package manager)

Run locally:

```sh
bun install
bun run dev
```

Build for production:

```sh
bun run build
bun run preview
```

## Stack

- Vite
- React + TypeScript
- Tailwind CSS
- Radix UI / shadcn-ui
- Supabase (via Lovable Cloud)

- TanStack Query for server data

The Lovable preview is already supervised; do not start a second server there. Private credentials never belong in frontend code.

## Regression checks

```sh
bun test scripts/tests
bun run lint
```

CI additionally checks migration guards and builds. Keep active tests/scripts, referenced assets and migration history during cleanup. Empty security/audit tables and dynamically invoked workers are not automatically dead code.

---

## MIPS Hardware Integration

### Overview

The system integrates with MIPS (RuoYi-Vue v3) middleware for biometric face-recognition terminals. This enables automated attendance marking for members, employees, and trainers via face scan.

### Edge Functions

| Function | Endpoint | Purpose |
|---|---|---|
| `mips-proxy` | `/functions/v1/mips-proxy` | Generic proxy to MIPS RuoYi API (branch-aware) |
| `sync-to-mips` | `/functions/v1/sync-to-mips` | Sync person (member/employee/trainer) to MIPS: create/update person, upload photo, dispatch to devices |
| `mips-webhook-receiver` | `/functions/v1/mips-webhook-receiver` | Receive face-scan callbacks from MIPS → lookup person → mark attendance → log → relay |

### Webhook configuration

Use the deployed `mips-webhook-receiver` endpoint from the existing branch integration configuration; do not hardcode project-specific endpoints in this guide.

MIPS Admin → Device Management → Configure Device → Server Configuration:
- **Recognition Record Upload URL**: deployed receiver endpoint
- **Register Person Data Upload URL**: deployed receiver endpoint
- **Device Heartbeat Upload URL**: Keep default

### Attendance Flow

```
Face Terminal → MIPS Middleware (HTTP) → mips-webhook-receiver (HTTPS)
  → 3-tier person lookup (mips_person_sn → mips_person_id → code normalization)
  → Member: member_check_in RPC → member_attendance
  → Staff/Trainer: check-in/out toggle → staff_attendance
  → access_logs (all events)
  → Relay original payload back to MIPS
```

### Person Sync Flow

```
CRM (Add/Edit Member/Employee/Trainer) → sync-to-mips Edge Function
  → Login to MIPS RuoYi API
  → Create/Update person (personSn = hyphen-stripped code)
  → Upload photo (JPG, max 400KB, two-step: upload file → PUT photoUri)
  → Dispatch to all active devices (POST /through/device/syncPerson)
  → Write mips_person_id + mips_person_sn back to CRM
```

### Key Database Columns

| Table | Column | Description |
|---|---|---|
| members/employees/trainers | `mips_person_id` | Numeric MIPS personId (e.g. "21") |
| members/employees/trainers | `mips_person_sn` | PersonSn sent to MIPS (e.g. "EMPMM3FYN8U") — used for webhook lookup |
| members/employees/trainers | `mips_sync_status` | `synced`, `failed`, or `pending` |

### Per-Branch Configuration

MIPS server connections are stored in `mips_connections` table (per branch). Managed via Device Command Center → MIPS Server Connection card.

### Full API Reference

See `.lovable/mips-api-reference.md` for complete MIPS API documentation including endpoints, payload formats, field mappings, and troubleshooting.
