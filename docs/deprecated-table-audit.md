# Deprecated-table cleanup recheck

Verified 27 October 2026 UTC. Scope: the nine candidates from the earlier orphan-data audit.

## Result

No tables were dropped or marked deprecated. The earlier audit incorrectly classified three active tables as drop candidates; it also listed six tables already removed by historical migrations.

| Table | Live rows/state | Decision and evidence |
| --- | --- | --- |
| `role_permissions` | Absent | Already removed in historical migration `20260610142254…`; no active table callers found. |
| `permissions` | Absent | Already removed with `role_permissions`; the frontend permissions helper is unrelated to this old table. |
| `payroll_rules` | Absent | Historical migration `20260825201436…` removed it; no active table callers found. |
| `workout_templates` | Absent | Replaced by `fitness_plan_templates`, then removed in `20260510084759…`. |
| `diet_templates` | Absent | Replaced by `fitness_plan_templates`, then removed in `20260510084759…`. |
| `ai_plan_logs` | Absent | Removed in `20260510084759…`; no current producer found. |
| `pt_attendance_corrections` | 0 | Keep: live request/decision RPCs write/read corrections; both automatic-attendance board RPCs join them. |
| `pt_trainer_transfers` | 1 | Keep: live transfer RPC records changes; undo RPC reads this history. |
| `referral_code_attempts` | 0 | Keep: live referral validation records attempts and limits repeated failed validation. Empty does not mean unused. |

## Current frontend/backend links

- `PtCorrectionRequestDrawer.tsx` calls `pt_attendance_request_correction`; correction approval uses `pt_attendance_decide_correction`. Live `pt_auto_attendance_board` and `pt_auto_attendance_my_board` join correction rows.
- `TransferPTClientsDrawer.tsx` calls `transfer_pt_package_trainer`, which inserts transfer history. `undo_pt_trainer_transfer` reads this history. Transfer controls are used from HRM, PT and member-profile screens.
- `ReferralCodeField.tsx` calls `validate_referral_code`, whose live body reads/inserts `referral_code_attempts`. It blocks at eight failures within fifteen minutes. `register-member` separately resolves validated referral codes through `_resolve_referral_code`.

## Verification and limits

- Read-only live queries confirmed exact counts and `to_regclass` absence for all six old tables.
- Inspected live function-body references and catalog dependencies, including table policies and constraints.
- No scheduled job command directly names these candidates; this does not override RPC dependencies.
- Independent source review covered frontend, functions, scripts, docs and historical migrations. Generated types alone were not treated as evidence of active use.
- No application code, schema, grants, policies, data, storage, scheduled jobs or security-finding statuses changed. No transactions or messages were triggered. Browser testing was unnecessary for this read-only cleanup decision.
- Observability files were unavailable in this sandbox; no new build or runtime verification is claimed.