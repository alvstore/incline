## Goal

Make every page respect the active theme (Theme Picker + light/dark) by removing hardcoded Tailwind palette classes (`slate-*`, `indigo-*`, `violet-*`, `emerald-*`, `amber-*`, `red-*`, `sky-*`, `rose-*`, `gray-*`, etc.) and routing all color through semantic tokens (`background`, `foreground`, `card`, `muted`, `primary`, `accent`, `success`, `warning`, `destructive`, `info`, `border`, `ring`).

The two pages explicitly called out (`/staff-roster`, `/admin-roles`) get a focused refactor. Then a project-wide sweep handles the rest in waves so we don't ship one massive unreviewable change.

## Scope

### Wave 1 — Explicitly requested pages (this round)
1. **Staff Roster** — `src/pages/StaffRoster.tsx` + child components used by day/week/month views:
   - `src/components/roster/*` (whatever the page imports — day grid, week grid, shift cells, legend, filters, shift drawers).
   - Tokens for shift sources (planned / override / off / late / on-time) must map to `primary`, `warning`, `muted`, `destructive`, `success` respectively so theme + dark mode re-skin properly.
2. **Admin Roles** — `src/pages/AdminRoles.tsx` + any role-matrix / capability-grid / drawer components it imports.
   - Role pills, capability check/cross indicators, "owner-locked" banners → semantic tokens.

### Wave 2 — Project-wide audit (separate follow-up rounds)
A grep across `src/pages` + `src/components` shows ~181 files still using raw palette classes. We bucket them into shippable waves:

```text
Wave 2a — High-traffic operational pages
  Members, Leads, Plans, Payments, POS, Finance, Lockers, MemberCheckout,
  EquipmentMaintenance, FollowUpCenter, Integrations, Referrals

Wave 2b — Member-facing portal
  MemberStore, MemberClassBooking, MemberAnnouncements, MemberFeedback,
  MyScanReport, HowbodyPublicReport, HowbodyLogin, Feedback

Wave 2c — HRM + Roster ecosystem (already partly in Wave 1)
  HRM.tsx, hrm/* components, PayrollRunPanel, PoliciesTab, HrSettingsTab,
  CreateContractDrawer, OffboardStaffSheet, SignedContractViewer, etc.

Wave 2d — Comms + Campaigns + IG + WhatsApp
  WhatsAppChat, communications/*, campaigns/*, ig-automations/*,
  whatsapp/*, invoices/* (payment-link drawers)

Wave 2e — Fitness + Bookings + Misc
  fitness/*, bookings/*, products/*, profile/CommunicationPreferences,
  consent/*, ui/* low-level (toast, alert-dialog, live-pill, liquid-button)
```

Each wave runs as its own approved task so reviewers can sanity-check 10–25 files at a time instead of 181.

## Token Mapping (canonical, reused across all waves)

```text
bg-white / bg-slate-50 / bg-gray-50         → bg-card / bg-background
text-slate-900 / text-gray-900              → text-foreground
text-slate-700 / text-slate-600             → text-foreground / text-muted-foreground
text-slate-500 / text-slate-400             → text-muted-foreground
border-slate-200 / border-gray-200          → border-border
shadow-slate-200/50                         → shadow-md (drop colored shadow)
bg-indigo-* / bg-violet-* / brand gradient  → bg-primary  (gradient: from-primary to-primary/70)
text-indigo-700 / text-violet-700           → text-primary
bg-indigo-50 / bg-violet-50                 → bg-primary/10
ring-indigo-500                             → ring-ring
bg-emerald-* / text-emerald-*               → bg-success / text-success
bg-amber-* / text-amber-*                   → bg-warning / text-warning
bg-red-* / text-red-* / bg-rose-*           → bg-destructive / text-destructive
bg-sky-* / text-sky-* / bg-blue-*           → bg-info / text-info
bg-blue-400 (frozen pill)                   → bg-info  (keep "frozen" semantic)
```

Tier / category palettes that need multiple distinct hues keep their hue families but route through token-aware variants (`primary`, `warning`, `info`, `success`) so they still re-skin.

## Approach (per wave)

1. List the files in the wave with `rg -l`.
2. For each file: read once → single `code--line_replace` (or `code--write` only if the whole file is replaced) that swaps colors only, preserves layout/spacing/typography classes.
3. Re-grep the wave's files to confirm zero hardcoded palette classes remain.
4. Visual spot-check in preview: toggle Theme Picker + dark mode on 2–3 representative pages from the wave.

## Constraints

- Color-only changes. Do not touch copy, layout, data fetching, business logic, RBAC, or query keys.
- Keep `rounded-2xl`, soft shadows, and Vuexy density unchanged.
- Status semantics preserved (success=green, warning=amber, destructive=red, info=sky/blue, frozen=info).
- Keep `bg-gradient-to-br from-primary to-primary/70 text-primary-foreground` for hero/KPI cards.
- Do NOT touch auto-generated files (`integrations/supabase/client.ts`, `types.ts`, `supabase/config.toml`, `.env`).
- `src/components/ui/*` primitives are only touched where the hardcoded color is the bug (toast, alert-dialog, live-pill). Otherwise leave shadcn primitives alone.

## Validation

- After each wave: open Settings → Appearance, switch theme + dark mode, confirm the wave's pages re-skin instead of staying indigo/slate.
- Confirm contrast on hero gradient cards in both modes.
- Confirm status pills (active/frozen/overdue/partial/pending) keep their meaning across themes.
- No regressions in drawers opened from each page.

## Deliverable for THIS approval

Wave 1 only: refactor `StaffRoster.tsx` + its child roster components, and `AdminRoles.tsx` + its role/capability child components. Waves 2a–2e are listed here for visibility and will be requested as separate approvals after Wave 1 ships.
