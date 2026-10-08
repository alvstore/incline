# Security & Lint Audit — phased fixes (2026-10-08)
Source doc: /mnt/documents/Incline_Security_Lint_Audit.md

- [x] Phase 1a — lock 51 internal-only privileged functions to background jobs (migration 0010)
- [ ] Phase 1b — in-function permission checks for the 26 app-called functions (check-in, class attendance, coupons, campaign audiences, …)
- [ ] Phase 2 — close read-function data leaks; recheck the 5 visitor-open functions (public body-scan link token, password setup token)
- [ ] Phase 3 — review remaining ~178 signed-in-callable privileged functions; default-deny for new functions
- [ ] Phase 4 — move 3 extensions out of public; CI check failing migrations that add an unprotected SECURITY DEFINER function
- [ ] Phase 5 — clear 38 lint warnings
- [ ] Phase 6 — verify as member + front-desk after each phase; update audit doc status

# Earlier open items
- [ ] Member app: native Android/iOS requires a separate Expo project (web only here)
- [ ] MIPS restart incident: cold-standby parity; re-enable workers one at a time
- [ ] Google Business Profile OAuth expired — owner must reconnect under Settings → Integrations
- [ ] Live checks pending: first October payroll settlement; one small real purchase as Mohit Gurjar
