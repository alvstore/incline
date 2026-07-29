
## Goal

Audit + polish the existing PT module to meet the Epic's intent without breaking the many downstream systems (invoices, commissions, MIPS check-ins, member portal, cancel flow). Nothing is renamed or duplicated.

## Mapping: Epic → existing stack (no changes needed)

| Epic asks for | Already exists as |
|---|---|
| `pt_packages` with type/session_count/duration/price | `pt_packages` (`package_type` = `session_based`/`monthly`, `sessions_included`, `duration_days`, `price`) |
| `pt_subscriptions` | `member_pt_packages` (member_id, trainer_id, package_id, invoice_id, status enum, sessions_total/remaining, start/expiry_date) |
| `pt_attendance` | `pt_sessions` (session_id, member_pt_package_id, trainer_id, scheduled_at, notes, status) |
| Sales form → invoice + subscription (5% GST) | `PurchasePTPackageDrawer` + `purchase_pt_package` RPC (atomic: invoice, GST-5% split, subscription, commission, idempotency) |
| `log_pt_attendance` validation RPC | `log_pt_session` RPC (blocks on inactive/expired/no_sessions_left, auto-completes pack, creates gym check-in) |
| Cancel/unpaid handling | `cancel_invoice` RPC + Pending-payment section on PT Sessions page |

## Gaps this plan fixes

### 1. Trainer Dashboard — TanStack Table with unified Progress column
**File:** `src/pages/MyClients.tsx` (PT tab only)

Replace the current 2-column PT card grid with a proper `@tanstack/react-table` (already a dep):

```
Member | Plan | Progress                         | Action
Aryan  | 12-Session Pack  | 5 / 12 sessions [bar] | [Mark Session ▾]
Nida   | Monthly Elite    | Expires 15 Aug (18d)  | [Mark Session ▾]
```

- Sortable columns, sticky header, `rounded-2xl` shell, empty/loading states.
- "Progress" cell branches on `package_type`: session-based → `used/total` + progress bar; monthly → expiry date + days-left chip (red ≤7d).
- Keep the existing `MarkPtStatusMenu` as the action cell (unchanged API).
- General Clients tab stays as cards (out of Epic scope).

### 2. True Optimistic UI on Mark Session
**File:** `src/components/pt/MarkPtStatusMenu.tsx`

Currently `onSuccess` invalidates. Upgrade `useMutation` to real optimistic updates:

- `onMutate`: snapshot every relevant cache (`['member-pt-packages']`, `['active-member-packages', …]`, `['trainer-pt-clients', trainerId]`, `['client-session-stats', trainerId]`), then patch:
  - `present`/`late`/`absent` on a session pack → decrement `sessions_remaining` by 1, bump `sessionStats.completed` for present/late.
  - `holiday` → no counter change.
- `onError`: restore from snapshots + red sonner toast using the existing friendly-error map (adds "Sessions exhausted" / "Package expired" wording).
- `onSettled`: invalidate the same keys so the server value wins.
- Add a 250ms green pulse on the row via a shared `data-flash` attribute (Vuexy soft ring).

### 3. Enforce strictly 5% GST at the DB
**Migration** — small safety valve on top of the existing RPC:

- Add a `CHECK (_gst_rate = 5)` isn't possible on function args, so instead add a guard clause inside `purchase_pt_package`: `IF _gst_rate <> 5 THEN RAISE EXCEPTION 'pt_gst_must_be_5';`
- Backfill guard on `invoice_items` for PT lines: trigger `pt_invoice_items_gst_check` that raises if `item_type='pt_package'` and `gst_percentage <> 5`.
- No table shape changes; no data migration.

### 4. Trainer table query
**File:** `src/hooks/useMemberData.ts` (trainer PT clients) — no behaviour change, just add `package_type`, `sessions_total`, `expiry_date` to the select so the table renders both progress modes without a second round-trip. Confirmed already returned; only widen the TS type.

## Explicitly NOT doing (per your "audit + polish" choice)

- No new `pt_subscriptions` / `pt_attendance` / `log_pt_attendance` tables or RPCs — would duplicate live logic and break `cancel_invoice`, trainer commissions, MIPS coupling, member portal, and PT history.
- No changes to `purchase_pt_package`, `cancel_invoice`, or the Sales drawer beyond the GST guard — they already do exactly what Epic 2 describes.
- No schema renames.

## Files touched

- `src/pages/MyClients.tsx` — PT tab replaced with TanStack table.
- `src/components/pt/MarkPtStatusMenu.tsx` — optimistic onMutate/onError/onSettled.
- `src/hooks/useMemberData.ts` — widen PT client select fields (type only if data already present).
- One migration: 5% GST guard in `purchase_pt_package` + `invoice_items` trigger for PT lines.

## Verification

- Trigger `Mark Present` on a session pack with 5/12 → counter jumps to 6/12 instantly; toast confirms; refresh keeps 6/12.
- Force RPC error (mock exhausted pack) → counter snaps back to 5/12; red toast "No PT sessions remaining".
- `INSERT` into `invoice_items` with `item_type='pt_package', gst_percentage=18` → raises.
- `purchase_pt_package(_gst_rate=>0)` → raises `pt_gst_must_be_5`.

