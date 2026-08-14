# Plan: Fix Task Triggers, POS RPC, UI Polish, and RLS Audit

Fix several critical database errors (missing functions/columns), improve UI/UX for PT installments, and perform a security audit on RLS policies.

## User Review Required

> [!IMPORTANT]
> - **RLS Audit**: I will tighten policies to prevent data leaks. If any staff member loses access they previously had, please specify which table and role.
> - **PT UI**: I'm moving the installment display to a more readable card-based format.

## Technical Details

### 1. Database & RPC Fixes
- **Missing Function**: Create `public.create_system_notification` which is referenced by the `tasks_notify_management` trigger but currently missing.
- **POS RPC Error**: Add `gst_percentage` and `customer_gstin` support to the `create_pos_sale` RPC to match the frontend call and fix the 400 error.
- **Task Query Fix**: Resolve the 404/columns error by ensuring the `tasks` table has all queried columns and that the REST endpoint is correctly routed.

### 2. UI/UX Refinement
- **PT Sessions**: Redesign the "Installment Block" in `src/pages/PTSessions.tsx` (or identified sub-component) using standard Vuexy patterns (rounded-2xl, soft shadows, clear status badges) instead of a "not cool" layout.
- **Member Search**: Verify `MemberStore.tsx` and related components use the optimized `search_members` RPC.

### 3. Security Hardening (RLS Audit)
- Scan for policies allowing broad `authenticated` or `anon` access without proper checks.
- Fix identified leaks in `howbody_public_report_tokens`, `leads`, `profiles`, and `role_capabilities`.
- Ensure `public.has_role` is used consistently for staff-level checks.

## Progress Tracking
- [ ] Create missing `create_system_notification` function
- [ ] Patch `create_pos_sale` with GST columns
- [ ] Redesign PT Installment UI
- [ ] Audit and fix RLS policies
- [ ] Verify Task creation flow