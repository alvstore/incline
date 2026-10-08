# Security & Lint Audit — phased fixes (2026-10-08)
Source doc: /mnt/documents/Incline_Security_Lint_Audit.md

- [x] Phase 1a — lock 51 internal-only privileged functions to background jobs (migration 0010)
- [x] Phase 1b — in-function permission checks for the 26 app-called functions (migrations 0011–0013; verified live as member + owner: 47 checks)
- [x] Phase 2 — read-function leaks closed (migration 0014): 15 locked to background, 6 helpers self-or-staff, audit reports owner/admin; 5 visitor-open functions rechecked (body-scan token fn locked; share links never issued)
- [x] Phase 3 — remaining signed-in-callable privileged functions reviewed (migrations 0015–0016: 27 locked to background, guards on purchase/lifecycle/punch/consent/scan-quota/presence/measurement helpers); default-deny for new functions is migration 0018
- [x] Phase 4 — pg_trgm + vector moved to `extensions` (0017; pg_net not relocatable — its objects already live in `net`); new functions closed by default (0018); CI step `scripts/check-definer-guards.ts` fails unprotected SECURITY DEFINER functions
- [x] Phase 3 follow-ups — `match_common_plans` re-tested live as Mohit: own member 200, two other members 403 (earlier alarm was a false positive); `resolve_mips_person_alias` callers (mips-webhook-receiver, reconcile-mips-pass-records) both use service-role clients
- [x] Member PT add-on: server is staff-only by design (`_purchase_pt_package_impl` → "Not authorized") but the drawer toasted "activated" — member mode now files a front-desk task (same path as Renewal Concierge), trainer optional; staff mode honours `success:false`
- [x] Phase 5 — 38 lint warnings → 0 (previewAuthStorage.ts excluded from lint: platform-generated)
- [x] Phase 6 — verified live after Phase 4/5: member (14 pages, 0 failed calls), front-desk manager (15 pages, 10/10 RPC allow/deny), visitor (6 public pages); audit doc updated as `Incline_Security_Lint_Audit_v2.md`
- [x] Dual-role fix — manager+trainer accounts saw "No Branch Assigned" everywhere (BranchContext precedence manager > staff/trainer > member)
- [ ] Members page: pre-existing "Function components cannot be given refs" console warning (Primitive.button.Slot) — cosmetic

# Earlier open items
- [ ] Member app: native Android/iOS requires a separate Expo project (web only here)
- [ ] MIPS restart incident: cold-standby parity; re-enable workers one at a time
- [ ] Google Business Profile OAuth expired — owner must reconnect under Settings → Integrations
- [ ] Live checks pending: first October payroll settlement; one small real purchase as Mohit Gurjar
