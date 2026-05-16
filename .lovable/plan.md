# Audit & Resolution Plan

## 1. AI Tables — Cleanup & Consolidation

**Findings (live DB):**
- 7 `ai_*` tables exist: `ai_call_logs`, `ai_tool_logs`, `ai_dashboard_insights`, `ai_knowledge`, `ai_memory`, `ai_provider_configs`, `ai_purposes`.
- `ai_knowledge` and `ai_memory` are empty → the WhatsApp AI agent currently keeps short-term context in the edge function only; nothing is persisted.
- `ai_call_logs` and `ai_tool_logs` overlap (one logs LLM calls, the other tool invocations) and have no admin UI to clear/inspect.

**Plan:**
1. **Consolidate:** keep `ai_call_logs` (LLM request/response/tokens/cost) and `ai_tool_logs` (tool name, args, result, latency). Document the split in a header comment — they serve different debug axes (LLM vs tool layer), so we keep both but stop creating new variants.
2. **Wire memory persistence:** update `_shared/ai-runtime.ts` and `_shared/ai-tool-executor.ts` to:
   - Write per-conversation short-term turns to `ai_memory` (scope=`conversation`, ttl 7d).
   - Write durable facts the agent extracts ("member prefers evening slots", "lead is price-sensitive") to `ai_knowledge` (scope=`contact`/`member`).
   - Add nightly pg_cron to purge `ai_memory` rows older than TTL.
3. **Admin UI — `Settings → AI Studio → Logs & Memory`:**
   - Tabs: Call Logs · Tool Logs · Memory · Knowledge.
   - Filters: provider, purpose, date range, conversation, contact.
   - Bulk actions: **Clear selected**, **Clear all older than N days**, **Export CSV**.
   - Row drawer with full request/response JSON, token cost, error.

## 2. System Health Audit

**Plan:**
1. Run `supabase--linter` + sweep `error_logs` for top fingerprints from the last 30 days.
2. Build a one-shot audit report in `/mnt/documents/` covering: missing FKs, orphan rows, RLS gaps, dead tables, duplicate ai_* writes, edge-fn 5xx hotspots.
3. Add a **System Health → Audit** tab in the existing `SystemHealth.tsx` page that surfaces: linter findings, top error fingerprints, dead/empty tables, last cron run per job, edge fn health. Each row has a "Mark resolved" / "Open runbook" action.
4. Auto-resolve obvious issues via a follow-up migration (drop dead columns, add missing indexes, tighten RLS).

## 3. WhatsApp / SMS / Email Template Manager UI

**Findings:** `Settings → Communication Templates` lets you generate via AI and sync from Meta, but there is **no manual create / edit form** for any channel and no edit-then-resubmit flow for WhatsApp.

**Plan — `TemplateEditorDrawer` (right-side Sheet, single component for all 3 channels):**
- Header: channel chip · category dropdown (MARKETING / UTILITY / AUTHENTICATION for WA; simple for SMS/Email).
- Body editor with `{{1}}`, `{{2}}` insertion chips + live preview rendered with sample data.
- WhatsApp-specific: header type (none/text/image/video/document) + sample URL, footer text, up to 3 buttons (quick reply / URL / phone).
- Email-specific: subject, from name, HTML editor (TipTap) with merge-tag chips.
- SMS-specific: 160-char counter, DLT principal/template ID inputs.
- Live validation: placeholder count vs variables provided, Meta category-rule guard (reuse server validator), DLT length check.
- Actions: **Save Draft** · **Submit to Meta** (WA only) · **Test Send** (sends to logged-in admin's number).
- Reachable from every tab (CRM Templates, Meta Approved, SMS Templates, Email Templates) via "New Template" and "Edit" buttons on each row.

## 4. Smarter Campaign Manager — Reduce Meta Approval Dependency

**Research summary (Meta Cloud API rules, 2025):**
- Cold/outside-24h sends MUST use an approved template — no workaround.
- Inside the 24h customer service window you can send free-form text/media → use it for engaged contacts.
- Approved templates with `{{1}}`...`{{n}}` variables and dynamic header media are reusable across many campaigns.
- Meta now supports **Authentication, Utility, Marketing** categories and **Marketing Lite** pacing — over-blasting marketing triggers 131049.

**Plan — "Reusable Template Library" model:**
1. **Seed a small library of 8-10 evergreen templates** (covers 90% of sends) — submit once, reuse forever:
   - `promo_offer_generic` (MARKETING, image header + `{{1}}=name, {{2}}=offer, {{3}}=cta_url`)
   - `event_invite_generic` (MARKETING, image/video header + name/event/date/venue/rsvp_url)
   - `announcement_generic` (UTILITY, name + headline + details + link)
   - `reengage_lost_lead` (MARKETING, name + reason + offer + link)
   - `birthday_wish`, `renewal_reminder`, `class_reminder`, `payment_due` (UTILITY)
   - `lead_alert_internal` (UTILITY → staff)
2. **CampaignWizard upgrade:**
   - Step "Template" auto-picks the right approved template by campaign type and shows only the variables/media slots that need filling (no more "pick from 50 templates").
   - "Why this template?" tooltip explains category + estimated deliverability.
   - **Audience splitting:** automatically splits recipients into (a) **in 24h window** → free-form rich message and (b) **outside window** → reusable approved template. UI shows both previews.
   - **Deliverability guardrails:** per-day MARKETING cap per recipient (default 1), per-campaign throttle, 131049 trend warning before send.
   - **A/B header media:** upload 2 images; campaign sends 50/50 and reports CTR.
3. **Auto-submit-on-demand:** if user truly needs a custom template, the wizard offers "Submit & schedule for tomorrow" — submits to Meta, waits for `APPROVED` webhook, then auto-launches the campaign.
4. **Smart fallback chain:** WhatsApp blocked / 131049 → auto-retry via SMS (DLT) → Email → in-app, configurable per campaign.

## 5. Trainer Code Bugs

**Findings (live DB):**
- DB trigger correctly produces `TR-INC-00001`.
- `src/services/hrmService.ts:304` does `code: \`TR-${trainer_code || ...}\`` → re-prefixes "TR-" producing **`TR-TR-INC-00001`** (matches the user report).
- `src/pages/Employees.tsx:163` sets `code: null` for trainer rows in its merged list → trainers show `-` in the Employees page.

**Plan:**
1. Remove the `TR-` re-prefix in `hrmService.getUnifiedPayrollStaff` — use `trainer_code` as-is.
2. In `Employees.tsx`, set `code: trainer.trainer_code` for trainer rows.
3. Backfill: normalise any historical `TR-TR-*` rows with an UPDATE migration. Also standardise sequence padding (one row is `TR-INC-0004`, others are `TR-INC-00001` — fix trigger to always use 5-digit padding and backfill).

## 6. Single Source of Truth for Trainer CRUD

**Findings:** `AddTrainerDrawer.tsx` and `EditTrainerDrawer.tsx` are two separate components with diverging field sets (Edit drawer was just patched to refetch full profile, Add drawer collects different fields).

**Plan:**
1. Create `TrainerFormDrawer.tsx` (mode: `create | edit`) — single Sheet, single Zod schema, single TanStack mutation.
2. Sections: Identity (name/email/phone/DOB/gender/address/govt-id) · Role & Branch · Compensation (salary type, fixed, PT share, hourly) · Specializations & Certifications · Biometric (photo + MIPS sync) · Weekly off.
3. Replace both `AddTrainerDrawer` and `EditTrainerDrawer` usages with the unified component. Delete the old files.
4. Apply the same unification to employees (`EmployeeFormDrawer`) so both staff types follow the same pattern.

---

## Technical Notes

- All new tables/columns via `supabase--migration` with RLS.
- AI memory writes go through a new helper `ai-memory.ts` in `_shared` — never raw inserts.
- Template editor reuses existing `manage-whatsapp-templates`, `send-email`, `send-sms` edge fns; no new dispatcher.
- Campaign wizard audience splitter uses existing `resolve_campaign_audience` RPC + a new `is_in_24h_window(contact_id)` SQL helper.
- Trainer/Employee form unification keeps existing `trainerService` / `hrmService` APIs unchanged; only UI is refactored.

## Files Touched (high level)

- **New:** `TemplateEditorDrawer.tsx`, `TrainerFormDrawer.tsx`, `EmployeeFormDrawer.tsx`, `AIStudioLogsPanel.tsx`, `SystemHealthAuditTab.tsx`, `_shared/ai-memory.ts`.
- **Edited:** `hrmService.ts`, `Employees.tsx`, `CampaignWizard.tsx`, `SystemHealth.tsx`, `Settings.tsx` (route AI Studio Logs), `ai-runtime.ts`, `ai-tool-executor.ts`.
- **Deleted:** `AddTrainerDrawer.tsx`, `EditTrainerDrawer.tsx`, `AddEmployeeDrawer.tsx`, `EditEmployeeDrawer.tsx`.
- **Migrations:** trainer-code padding fix + backfill, ai_memory TTL cron, seed library of evergreen WhatsApp templates, indexes from audit.
