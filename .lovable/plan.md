# Plan: System Health Audit + Lint Sweep + Template Manager UI polish

Three independent workstreams, executed in order.

---

## 1. System Health — fix all errors recorded in `error_logs`

Triage of the 46 rows in today's export (grouped by root cause):

### A. Automation Brain 502s (3 rows, 2026-05-16)
- `run_retention_nudges`, `process_whatsapp_retry_queue`, `process_comm_retry_queue` all returned 502 once.
- These are transient edge-function cold-start failures. Fix: in `automation-brain/index.ts`, wrap each rule invocation with **one retry** (300ms backoff) on 5xx **before** calling `log_error_event`. Bumps reliability without spamming the log.

### B. Database error: `operator does not exist: lead_status = text` (22 hits on /announcements)
- A query compares the `lead_status` enum to a raw text value. Find the offending `.eq('lead_status', someString)` in announcement audience resolution (likely `resolve_campaign_audience` RPC or contact_segments filter). Cast with `::text` or use the enum value. **Action**: grep `lead_status` in SQL + ts, add explicit cast in the SQL function and migration.

### C. Dialog accessibility (2 hits, /my-clients + /trainer-dashboard)
- Radix warning: `DialogContent` missing `DialogTitle`. Audit every `Dialog`/`DialogContent` in `src/components` and `src/pages` and ensure either a visible `DialogTitle` or `<VisuallyHidden><DialogTitle>…</DialogTitle></VisuallyHidden>`.

### D. `Cannot read properties of undefined (reading 'add')` on `/` (2 hits, critical)
- Most likely a `classList.add` or `Set.add` on a nullable ref. Add a console.log line + null guard. Will inspect Index.tsx / Dashboard.tsx root effects.

### E. "Failed to fetch dynamically imported module" (4 critical hits)
- Classic stale-bundle issue after deploys (chunks for `MembersCountingChart`, `Trainers`, `Settings`, `Scene3D` 404 after redeploy). Fix:
  1. Add a `vite-plugin-pwa`-style **chunk-reload handler**: catch `import()` rejection in lazy boundaries → `window.location.reload()` once (guarded by sessionStorage flag to avoid loops).
  2. Wrap all `React.lazy(() => import(...))` calls via a `lazyWithRetry()` helper.

### F. Network errors (8 frontend hits, several routes)
- Already logged by `errorReporter`; reduce noise by **not logging** `TypeError: Failed to fetch` when `navigator.onLine === false`. Patch `src/lib/errorReporter.ts`.

### G. `signal is aborted without reason` (/auth, 1 hit)
- Benign React-Query abort during navigation. Add filter in `errorReporter` to drop `AbortError` / `signal is aborted` messages.

### H. `Invalid login credentials` (/auth, 1 hit)
- User typo, not a bug. Filter from logging (auth errors with status 400 from Supabase login).

### I. `/whatsapp-chat not_found` (10 hits)
- Probably a missing conversation lookup. Add 404-tolerant handling in `useConversation*` hook — return `null` instead of throwing.

---

## 2. Lint deep-clean

Current: **1 error + 62 warnings**.

### Error (must fix)
- `src/components/members/MemberProfileDrawer.tsx:959` — `no-unused-expressions`. Inspect and convert to a proper statement.

### Warning groups
| Group | Count | Fix strategy |
|------|------|-------------|
| `react-refresh/only-export-components` on shadcn ui files | ~9 | Add `// eslint-disable-next-line react-refresh/only-export-components` above the exported constants (these are shadcn boilerplate, splitting them breaks the upstream pattern) |
| `react-hooks/exhaustive-deps` | ~12 | Case-by-case: add missing deps, or wrap callback in `useCallback`, or split into two effects |
| `prefer-const` | 4 | Mechanical change `let` → `const` |
| `no-useless-escape` (planNormalizer) | 1 | Drop the `\-` in regex |
| Unused `eslint-disable` (Invoices.tsx) | 1 | Remove directive |
| Context files | 3 | Disable rule on the file (contexts intentionally export hook + provider) |

Goal: **0 errors, ≤10 deliberate warnings** (only the shadcn react-refresh ones, with disable comments justified).

---

## 3. Template Manager UI polish (skill: my-uiux)

Targets:
- `src/components/settings/CommunicationTemplatesHub.tsx`
- `src/components/settings/TemplateManager.tsx`
- `src/components/settings/MetaTemplatesPanel.tsx`
- `src/components/settings/WhatsAppTemplatesHealth.tsx`

Apply Vuexy aesthetic per project rules:
- Replace flat cards with `rounded-2xl bg-white shadow-lg shadow-slate-200/50`
- Status chips (approved/pending/rejected/draft) → colored badges (green/amber/red/slate)
- Convert all "Create / Edit Template" Dialogs to right-side **Sheets** (`sm:max-w-xl`, sticky header + footer) — strict no-Dialog policy
- Header KPI strip (Total / Approved / Pending / Coverage %) as gradient hero card (`from-violet-600 to-indigo-600`)
- Add Skeleton loading + empty state + per-row hover (`hover:bg-slate-50`)
- Inline preview pane on the right when editing (variable substitution preview)
- All icons from `lucide-react` only

No business-logic changes — pure presentation refactor inside the existing components.

---

## Execution order
1. Lint error + a11y Dialog fixes (unblocks CI)
2. error_logs root-causes (B, D, F, G, H, I)
3. Automation 502 retry (A)
4. Lazy-chunk retry helper (E)
5. Template Manager UI refactor (#3)
6. Sweep remaining lint warnings
7. Verify with `bun run lint` + clear `error_logs` open count

No database schema changes required (the `lead_status` cast is inside an existing function — replaced via migration).
