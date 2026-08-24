# Classes Workspace — Banners, Guest Trainers & Announce Flow

Rebuild `/classes` into a modern, image-first class console, add class banners and freelance-trainer support, and wire a one-click "Announce this class" campaign hand-off. All styling stays on the existing Vuexy theme tokens (rounded-2xl cards, soft slate shadows, indigo/violet accents) — no new palette.

## 1. Class banners

- New public storage bucket `class-banners` (image only, 5 MB limit).
- `classes` gains `banner_url` (text, nullable).
- Add/Edit Class drawers get a banner uploader: drag-or-click, live 16:9 crop preview, replace/remove, client-side compression via the existing `imageCompression` util.
- Member side (`/book` class booking): banner renders as the card hero with a graceful gradient placeholder (class-type icon) when no banner is set; also shown at the top of the booking sheet.
- Staff side: banner thumbnail on each class card and in the roster sheet header.

## 2. Guest / freelance trainers

- `classes` gains `external_trainer_name` (text, nullable) and `venue` (text, nullable).
- Trainer field becomes a searchable combobox: in-system trainers first, plus a "Guest trainer — type a name" option that reveals a free-text input.
- One of `trainer_id` or `external_trainer_name` is stored, never both; a DB check constraint enforces this.
- Everywhere a trainer name is rendered (class cards, roster, member booking, campaign `{{class_trainer}}` token) falls back to the guest name with a small "Guest" badge.

## 3. Classes page redesign

- Hero strip with the four KPIs restyled as themed stat cards (upcoming, today, total bookings, active trainers) with trend-free, dense layout.
- Class list becomes a responsive banner card grid (list view toggle retained for dense scanning), each card showing: banner, status badge, type chip, date/time, capacity progress bar, trainer/guest chip, and a row of quick actions — Roster, Edit, Announce, Cancel.
- Filters consolidated into one toolbar row (segmented Upcoming/Past/All + search + type + trainer), sticky on scroll.
- Proper skeleton, empty, and error states for every panel; all interactive targets ≥44px with visible focus rings.

## 4. Post-creation notification & quick actions

- After a class is created, the drawer shows a success step with quick actions: **Announce to members & staff**, **Copy class link**, **Create another**.
- "Announce" opens the existing Campaign Wizard pre-seeded with: campaign type = Event/Class, the new class pre-selected, `{{class_name}}` / `{{class_when}}` / `{{class_trainer}}` / `{{class_venue}}` auto-filled, the class banner attached as creative, and audience = Members + Staff. The user still reviews channels, template, and preview before sending — nothing sends automatically.
- The same "Announce" action is available on every class card and in the roster sheet, so older classes can be promoted too.

## Technical notes

- Migration: `ALTER TABLE public.classes ADD COLUMN banner_url text, external_trainer_name text, venue text` + check constraint; regenerate types afterwards.
- Bucket created with the storage tool; RLS on `storage.objects` — public read, write restricted to owner/admin/manager/staff of the branch.
- Wizard prefill uses a typed prop (`initialClassIds`, `initialType`, `initialAttachmentUrl`) rather than sessionStorage, matching the existing segment-prefill path but explicit.
- Data layer unchanged in shape: `classService`/`useClasses` extended for the new columns only; all fetching stays on TanStack Query with `branch_id` scoping and existing RLS.
- Composition/density guidance from the UI/UX Pro Max design-system pass; tokens and radii stay locked to the project theme.

## Out of scope

- Recurring class series, waitlist policy changes, and paid-class checkout logic stay as they are.
