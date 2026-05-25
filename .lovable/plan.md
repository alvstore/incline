
## Audit of the two skill packs

I fetched both folders from `alirezarezvani/claude-skills` and reviewed each SKILL.md. Here's the fit for Incline (multi-branch gym CRM):

| Skill | Pack | Verdict | Reason |
|---|---|---|---|
| `saas-metrics-coach` | finance | **Adopt** | Memberships = subscriptions. ARR/MRR/churn/LTV/CAC/NRR all map directly to Incline's recurring membership model and dashboard KPIs. |
| `customer-success-manager` | business-growth | **Adopt** | Health scoring, churn risk, expansion. Direct fit for Smart Retention Nudge Engine + lifecycle automation. |
| `revenue-operations` | business-growth | **Adopt** | Pipeline health, forecasting, GTM. Fits Leads/CRM + Marketing CRM v2 (lead → trial → member funnel). |
| `financial-analyst` | finance | Skip | DCF, WACC, corporate valuation — not relevant to single-business gym ops. |
| `sales-engineer` | business-growth | Skip | RFPs, PoCs, competitive matrices — B2B enterprise sales, not B2C gym. |
| `contract-and-proposal-writer` | business-growth | Skip | MSA/NDA/SOW drafting — Incline already has HRM Contracts v2 for staff and a fixed membership T&C; no B2B proposals. |
| `finance-skills` / `business-growth-skills` | both | Skip | These are README index files for the parent packs, not actual skills. |

## What I'll do

1. **Fetch the 3 adopted skills** (SKILL.md + references/ + scripts/ + assets/) from GitHub raw URLs.
2. **Write them under `.agents/skills/`** as drafts:
   - `.agents/skills/saas-metrics-coach/`
   - `.agents/skills/customer-success-manager/`
   - `.agents/skills/revenue-operations/`
3. **Light adaptation pass** on each SKILL.md description and Step-1 input prompts so retrieval and behaviour match Incline's domain:
   - "customer / subscription" → "member / membership"
   - "ARR/MRR" examples → use Incline plan types (monthly, quarterly, half-yearly, annual)
   - Add a short "Incline data sources" note pointing each skill at its real tables (`members`, `memberships`, `payments`, `leads`, `whatsapp_chat_settings`, `member_benefits`, etc.) so the agent queries the right place via `supabase--read_query`.
   - Add an `INR / ₹` note replacing `$` defaults.
   - Keep all Python scripts and reference files as-is (stdlib-only, deterministic).
4. **Apply each draft** with `skills--apply_draft` so they become active workspace skills surfaced by retrieval (and via `/` in the composer).
5. **No app/codebase changes.** No DB migrations. No edge-function changes. Skills are agent tooling, not runtime code.

## Out of scope

- Building UI for these analytics (skills are agent-side; if you later want a "Retention Health" dashboard widget powered by the same scoring model, that's a follow-up task).
- Modifying the 3 skipped skills.
- Touching existing skills already in `skills-lock.json`.

## Technical notes

- Drafts go to `.agents/skills/<name>/` only (never `.workspace/skills/` directly — that's managed by `apply_draft`).
- Each skill's `scripts/` are stdlib-only Python, runnable via the `code--exec` "copy then run" pattern.
- After apply, the skills will appear in Settings → Skills and trigger automatically when the user mentions churn, MRR, pipeline, health score, expansion, etc.

Confirm and I'll switch to build mode to fetch + adapt + apply the 3 skills.
