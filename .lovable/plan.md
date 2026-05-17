# Dual-Mode Personal Training — Implementation Plan

Decisions captured from clarifications:
1. **Purchase drawer** = toggle + catalog AND custom override (staff can either pick a catalog row or override sessions/duration/price inline).
2. **GST** = honor each package's existing `pt_packages.gst_percentage` (default 18%) — no hardcoded 5%.
3. **Attendance** = new atomic Postgres RPC `log_pt_session` (validates by package_type, decrements only for session-based, dispatches WhatsApp receipt via existing `dispatch-communication` queue).

---

## Epic 1 — Schema & Atomic Logging RPC

### 1a. Schema alignment (migration)

`pt_packages` already has `package_type text DEFAULT 'session_based'` and `duration_months int`. Normalize and harden:

- Convert `pt_packages.package_type` → enum `pt_package_type` with values `('session_based','monthly')`. Migrate any stray values to `'session_based'`.
- Add `member_pt_packages.package_type pt_package_type NOT NULL DEFAULT 'session_based'` (snapshot at purchase so future catalog changes don't mutate live packages).
- Add `member_pt_packages.expires_at` already exists as `expiry_date` — reuse. For monthly packs, `expiry_date = start_date + duration_months`; `sessions_total/remaining` set to NULL-safe sentinel 0.
- Make `pt_packages.total_sessions` nullable (monthly packages have no session count). Add CHECK: `(package_type='session_based' AND total_sessions > 0) OR (package_type='monthly' AND duration_months > 0)`.
- Same CHECK mirrored on `member_pt_packages`.

### 1b. New atomic RPC `public.log_pt_session(p_member_pt_package_id uuid, p_trainer_id uuid, p_notes text)`

SECURITY DEFINER, `SET search_path=public`. Logic:

```text
lock member_pt_packages row FOR UPDATE
if status != 'active' → raise 'package_not_active'
if package_type = 'session_based':
    if sessions_remaining <= 0 → raise 'no_sessions_left'
    insert pt_sessions(status='completed', scheduled_at=now())
    update member_pt_packages set sessions_used+=1, sessions_remaining-=1
    if sessions_remaining = 0 → status='completed'
if package_type = 'monthly':
    if current_date > expiry_date → raise 'package_expired'
    insert pt_sessions(status='completed', scheduled_at=now())
    (no counter change)
insert into communication_queue (or call dispatch via pg_net) with event='pt_session_logged'
return jsonb { session_id, package_type, remaining, expiry_date }
```

Receipt dispatch uses the existing **Communication Dispatcher** (see `mem://architecture/communication-dispatcher`): insert into the queue table the dispatcher already drains — we do NOT call `communication_logs` directly. WhatsApp template event key: `pt_session_logged` (added to `src/lib/templates/systemEvents.ts` catalog so the Templates Hub can generate it).

### 1c. Frontend hook

- New `src/services/ptService.ts` → `logPtSession({ memberPackageId, trainerId, notes })` calling the RPC.
- Replace any direct `pt_sessions` insert in trainer flows with this service.

---

## Epic 2 — `PurchasePTPackageDrawer.tsx` redesign

Drawer becomes a 3-region layout: **Mode Toggle → Catalog + Custom Builder → Sticky Checkout Bar**.

### Region 1 — Segmented Control (top)
shadcn `Tabs` styled as a pill segmented control:

```
[ 🏋  Session Pack ]   [ 📅  Monthly Plan ]
```

Switching mode resets the selected catalog row and the custom-builder state. Catalog query gets an `.eq('package_type', mode === 'session' ? 'session_based' : 'monthly')` filter.

### Region 2 — Catalog list + "Custom" card
- Renders only packages whose `package_type` matches the toggle (each card already shows price + GST badge).
- A final **"+ Build custom pack"** card opens an inline form:
  - Session mode: `Name` · `Number of Sessions` (number) · `Validity (months)` (number) · `Price (₹)` · `GST %` (default 18).
  - Monthly mode: `Name` · `Duration (months)` (number) · `Price (₹)` · `GST %` (default 18). Sessions input is physically hidden in this branch (Tailwind conditional render, not just hidden).
- Custom path creates an ad-hoc `pt_packages` row (flag `is_active=false`, `created_by` audited) then routes through the existing `purchase_pt_package` RPC so accounting/commissions stay identical.

### Region 3 — Sticky checkout bar (`absolute bottom-0 inset-x-0`)
Lives inside the SheetContent, separated by `border-t bg-white/95 backdrop-blur`. Shows live math from the selected/custom package:

```
Subtotal             ₹ 10,000.00
GST (18%)            ₹  1,800.00      <- pulled from package.gst_percentage, NOT hardcoded
─────────────────────────────────
Final Total          ₹ 11,800.00
[ Charge & Assign ]   primary, full-width on mobile
```

Math helper `computePtCheckout({ price, gstPct, gstInclusive })` lives in `src/lib/payments/ptCheckout.ts` so it's unit-testable:
- `gstInclusive=true` → subtotal = price / (1 + gstPct/100), tax = price − subtotal.
- otherwise → subtotal = price, tax = price × gstPct/100, total = subtotal + tax.

Charge flow:
1. If custom → upsert pt_packages, capture id.
2. Call existing 8-arg `purchase_pt_package` (`_member_id, _package_id, _trainer_id, _branch_id, _price_paid, _payment_method, _idempotency_key, _received_by`) — keeps `record_payment` as single source of truth.
3. Toast + invalidate `['my-pt-sessions']`, `['member-pt-packages']`.

### Visual spec
Vuexy: `rounded-2xl`, `shadow-lg shadow-slate-200/50`, Tabs use `bg-slate-100 p-1 rounded-xl` with active pill `bg-white shadow-sm`. Mode icons from lucide (`Dumbbell`, `CalendarDays`).

---

## Epic 3 — Trainer & Member visual delineation

### 3a. `TrainerDashboard.tsx` — Live Roster cards
New shared component `src/components/pt/PtPackageBadge.tsx`:

- **Session-based**: rounded badge `bg-indigo-50 text-indigo-700` showing `{remaining} Sessions Left` + 4-px `<Progress>` bar (used/total).
- **Monthly**: rounded badge `bg-emerald-50 text-emerald-700` with `CalendarDays` icon + `Monthly · Expires {format(expiry, 'd MMM')}`. When ≤7 days left, badge flips to amber; expired → red.

Wired into the existing roster row (no layout shift — badge slot already exists for the legacy "sessions" pill).

### 3b. `MyPTSessions.tsx` — Member hero card
New `src/components/member/PtStatusHero.tsx`:

- **Monthly**: circular countdown ring (`<RadialBar>` via existing recharts or pure SVG `stroke-dasharray`). Center label: `Days Left = expiry - today`. Subtitle: `Plan ends {date}` + `Renew` CTA when ≤7 days.
- **Session**: ring chart "Used vs Remaining" using same SVG primitive. Center: `{remaining}/{total} Sessions`. Subtitle: trainer name + `Book session` CTA.
- Both share Vuexy hero treatment: gradient `from-violet-600 to-indigo-600`, white text, `rounded-2xl`, soft shadow.

If member holds both types simultaneously, render two stacked hero cards (rare but legal).

---

## Files touched

**New**
- `supabase/migrations/<ts>_pt_dual_mode.sql` (enum + checks + sessions_total nullable + member snapshot column + log_pt_session RPC)
- `src/components/pt/PtPackageBadge.tsx`
- `src/components/member/PtStatusHero.tsx`
- `src/lib/payments/ptCheckout.ts` (+ vitest)
- `src/services/ptService.ts` (logPtSession)

**Edited**
- `src/components/pt/PurchasePTPackageDrawer.tsx` (full redesign)
- `src/components/pt/AddPTPackageDrawer.tsx` (add package_type toggle so the admin catalog can author both modes)
- `src/pages/TrainerDashboard.tsx` (swap pill → `PtPackageBadge`, call `logPtSession`)
- `src/pages/MyPTSessions.tsx` (render `PtStatusHero` above existing list)
- `src/lib/templates/systemEvents.ts` (register `pt_session_logged` event)
- `src/integrations/supabase/types.ts` (auto-regenerated)
- `mem://index.md` + new `mem://features/pt-dual-mode`

## Out of scope
- Razorpay/Webhook changes — already handled by `purchase_pt_package` + existing payment webhook.
- Auto-renewal of monthly packs — separate ticket.
- Migrating historical `pt_packages` rows to monthly — none exist yet.

## QA checklist before delivery
- Drawer math: `price=10000, gstPct=18` → subtotal 10,000 · GST 1,800 · total 11,800 (vitest case).
- Drawer math: `price=10000, gstPct=5` → 500 / 10,500.
- Toggle to Monthly physically removes the sessions input from the DOM (assert via test).
- `log_pt_session` rejects when session pack hits 0 (psql call).
- `log_pt_session` rejects when monthly past expiry (psql call).
- Trainer badge: progress bar reflects 8/12 = 66%.
- Member hero: monthly with 30-day plan started today renders "30 Days Left".
