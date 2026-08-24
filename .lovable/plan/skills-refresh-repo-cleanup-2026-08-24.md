# Skills Refresh + Repo Cleanup

Install two external skill sources (adapted to Incline conventions), author two new project agents, and clear out dead documentation.

## 1. Imported skills (adapted)

**Supabase official skill** — `supabase/agent-skills → skills/supabase`
Full SKILL.md + `references/` copied into `.agents/skills/supabase/`, then an "Incline overlay" section appended covering: Lovable Cloud naming (never say Supabase to the user), the mandatory GRANT-after-CREATE-TABLE rule, branch-scoped RLS, `has_role`/`has_capability` helpers, and the rule that all writes go through atomic RPCs (`record_payment`, `purchase_membership`, etc.). Complements the existing `supabase-postgres-best-practices` skill (perf) rather than replacing it — the new one covers auth, RLS, edge functions and migrations.

**Lovable design agent** — `sarthakrastogi/design-ai-agent/lovable`
That repo is a Python LangGraph app, not a portable skill. Its transferable value is the design critique/heuristics in `prompts.py`, `skills.py` and `data/`. Those are distilled into a new skill `.agents/skills/lovable-design-critic/` — a "review a screen before shipping" checklist (hierarchy, spacing rhythm, contrast, state coverage, motion) with an Incline overlay: Vuexy tokens, `rounded-2xl` + soft shadow cards, indigo/violet primary, lucide-only icons, the strict no-dialog/side-drawer rule, and required loading/empty/error states.

**ui-ux-pro-max** — already present and tracked in `skills-lock.json`; no reinstall. The design-critic skill defers to it for deep UI work instead of duplicating it.

## 2. New project agents

**`incline-dev-audit`** — audit playbook for this codebase. Walks: build/typecheck signal, security scan findings triage, RLS + GRANT coverage on new tables, branch-scoping on every query, dispatcher compliance (no direct `communication_logs` writes, no direct `send-*` calls), atomic-RPC compliance, edge-function standards (CORS, try/catch, version comment), and error capture via `log_error_event`. Outputs a severity-ranked findings report with file:line references and a fix order.

**`incline-e2e-playwright`** — browser testing playbook. Covers `/tmp/browser/<slug>` script layout, the Lovable auth-session restore sequence (cookies + localStorage before navigating), viewport rules, stable role-based selectors, console/network/runtime-error capture, screenshot evidence, plus ready-to-copy scripts under `scripts/` for the highest-value Incline flows: staff login → member search, member purchase → payment, campaign wizard send, and member portal booking.

Both are authored under `.agents/skills/<name>/` and activated with the skill apply tool. The Test agent was not selected, so no vitest/Deno skill is created.

## 3. Cleanup (all four categories approved)

- **Archived plans** — delete all 106 files in `.lovable/plan/`, the current `.lovable/plan.md` leftover, and the two stray root-level `.lovable/plan-fix-plan-*.md` files (~500 KB). Decisions already live in project memory.
- **Stale root files** — remove `replit.md`, `.replit`, `queries.sql`, `migration.sql`, and whichever of `deploy-all-dr.sh` / `sync-edge-functions.sh` duplicates the canonical copy under `scripts/dr/`. Each is confirmed unreferenced by code or CI before deletion.
- **Unused `docs/*.md`** — delete docs no code, CI job or runbook references. Operational runbooks stay: `dr-runbook.md`, `dr-secrets-checklist.md`, `communication-dispatcher.md`, `production-readiness.md`. Candidates for removal: `bundle-strategy.md`, `cloudflare-setup.md`, `gbp-local-visibility-audit.md`, `google-reviews-ai-brain.md`, `route-topology.md`, `workflows.md` — each verified with a repo-wide reference search first; anything still linked is kept and listed back to you.
- **`mem/*.md`** — the four files under `mem/architecture` and `mem/features` duplicate live project-memory entries. Any detail not already in memory is merged into the corresponding memory entry, then the folder is deleted.

Nothing under `src/`, `supabase/`, `.github/`, `README.md` or `.agents/skills/` is touched by the cleanup.

## Technical notes

- `skills-lock.json` gets entries for the two imported sources with their computed hashes; locally authored agents are not lock-tracked.
- Deletions are verified with `rg` reference checks before `rm`; a build runs afterwards to confirm nothing imported a removed file.
- No database or edge-function changes in this plan.
