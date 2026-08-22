# Trainer Coaching Console: redesign, punch fix, PT billing visibility

## What I verified

- `punch_duty(p_shift_type, p_branch_id)` falls back to `SELECT branch_id FROM public.profiles WHERE id = auth.uid()` when no branch is passed. **`profiles` has no `branch_id` column** — the trainer's branch lives on `trainers.branch_id` (and `employees.branch_id`). That is the exact source of the `column "branch_id" does not exist` 400 on `/rpc/punch_duty`, and why the dashboard then shows "Turnstile unreachable? Punch manually".
- `TrainerDashboard.tsx` calls `supabase.rpc('punch_duty', { p_shift_type })` without a branch, so it always hits the broken path.
- Trainers have **no read access to `invoices` or `payments`** — both are restricted to owner/admin/manager/staff (or the member themselves). So a trainer can never see whether their PT client actually paid. `member_pt_packages` (readable by trainers in their branch) does carry `invoice_id`, `payment_status`, `price_paid`, `subtotal`, `tax_amount` — enough to join server-side.
- `/my-clients` and `/schedule-session` are still on the legacy `border-border/50` card look, not the Vuexy theme (rounded-2xl, soft slate shadows, gradient KPI hero, colored status badges) used elsewhere in the app.

## Plan

### 1. Fix the duty punch (root cause)

Migration replacing `punch_duty` so branch resolution reads, in order:
1. `p_branch_id` argument,
2. `trainers.branch_id` for `auth.uid()`,
3. `employees.branch_id` for `auth.uid()`,
4. `get_user_branch(auth.uid())`.

`TrainerDashboard` will also pass the active branch from `BranchContext` explicitly. Punch-in and punch-out both stay atomic in the RPC. The "Turnstile unreachable? Punch manually" copy is reworded to a plain fallback affordance, and a real error toast surfaces the reason instead of a generic failure.

### 2. PT billing visibility for trainers (the new capability)

New security-definer RPC `get_trainer_pt_billing(_trainer_id uuid default null)` returning, per PT package sold by that trainer:
member name + code, package name, sale date, `price_paid`, amount paid, **balance due**, `payment_due_date`, invoice number, and a derived status (`paid` / `partial` / `overdue` / `pending`).

Guardrails:
- Only rows where `trainers.user_id = auth.uid()` (owners/admins may pass a trainer id).
- Returns **money summary only** — no customer email, address, GSTIN, or other invoice PII, so this does not widen the existing PII posture.
- Grants to `authenticated` only.

Surfaces in the UI:
- **My Clients → PT tab**: each client row gains a payment badge (Paid / Partial ₹X due / Overdue Nd) and a due-date line.
- **New "Billing" tab** on My Clients: list of the trainer's PT sales with totals — collected, outstanding, overdue — as gradient KPI cards.
- A detail **side drawer** per sale showing the payment breakdown and installment history (read-only; trainers never collect money in the app).

### 3. Redesign `/my-clients` and `/schedule-session`

Both pages move to the project's Vuexy language, keeping every existing action intact:
- Gradient violet/indigo KPI hero strip; `rounded-2xl bg-card shadow-lg` cards with `hover:shadow-xl` transitions.
- **Contact cards** for clients: avatar, name, member code, goal chip, tappable phone/WhatsApp actions, status badge, and an action row (Create Plan · Record Progress · View Progress · Mark session).
- PT tab keeps the dense table on desktop and collapses to contact cards under `md`; sticky header, zebra-free hover rows, skeleton loading, and proper empty states.
- Schedule Session becomes a two-column composer: a stepped session form on the left with a live summary + client roster on the right, `0 left` packages clearly blocked with an explanatory note rather than a silently disabled button.
- Accessibility pass: labels on every field, `aria-label` on icon buttons, visible focus rings, 44px touch targets, no horizontal scroll at 375px.

## Technical notes

- One migration: rewritten `punch_duty`, new `get_trainer_pt_billing` + grant.
- Frontend: `src/pages/MyClients.tsx`, `src/pages/ScheduleSession.tsx`, `src/pages/TrainerDashboard.tsx` (branch arg + copy), new `src/components/pt/TrainerBillingTab.tsx` and `TrainerSaleDetailDrawer.tsx`, new `src/hooks/useTrainerBilling.ts`.
- All data through TanStack Query with loading / error / empty states; no RLS relaxation on `invoices` or `payments`.
