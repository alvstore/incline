# Security & Lint Audit — phased fixes (2026-10-08)
Source doc: /mnt/documents/Incline_Security_Lint_Audit.md

- [x] Phase 1a — lock 51 internal-only privileged functions to background jobs (migration 0010)
- [x] Phase 1b — in-function permission checks for the 26 app-called functions (migrations 0011–0013; verified live as member + owner: 47 checks)
- [x] Phase 2 — read-function leaks closed (migration 0014): 15 locked to background, 6 helpers self-or-staff, audit reports owner/admin; 5 visitor-open functions rechecked (body-scan token fn locked; share links never issued)
- [x] Phase 3 — remaining signed-in-callable privileged functions reviewed (migrations 0015–0016: 27 locked to background, guards on purchase/lifecycle/punch/consent/scan-quota/presence/measurement helpers); default-deny for new functions is migration 0018
- [x] Phase 4 — pg_trgm + vector moved to `extensions` (0017; pg_net not relocatable — its objects already live in `net`); new functions closed by default (0018); CI step `scripts/check-definer-guards.ts` fails unprotected SECURITY DEFINER functions
- [x] Phase 3 follow-ups — `match_common_plans` re-tested live as Mohit: own member 200, two other members 403 (earlier alarm was a false positive); `resolve_mips_person_alias` callers (mips-webhook-receiver, reconcile-mips-pass-records) both use service-role clients
- [x] Member PT add-on: server is staff-only by design (`_purchase_pt_package_impl` → "Not authorized") but the drawer toasted "activated" — member mode now files a front-desk task (same path as Renewal Concierge), trainer optional; staff mode honours `success:false`
- [ ] Phase 5 — clear 38 lint warnings
- [ ] Phase 6 — verify as member + front-desk after each phase; update audit doc status

# Earlier open items
- [ ] Member app: native Android/iOS requires a separate Expo project (web only here)
- [ ] MIPS restart incident: cold-standby parity; re-enable workers one at a time
- [ ] Google Business Profile OAuth expired — owner must reconnect under Settings → Integrations
- [ ] Live checks pending: first October payroll settlement; one small real purchase as Mohit Gurjar
