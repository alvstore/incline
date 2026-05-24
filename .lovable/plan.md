## Goal

Every email leaving the platform (system notifications, AI-template-manager drafts, campaign broadcasts, contract/scan/lead/retention emails) must render inside the **single branded shell**:

- Header: black/gold, `INCLINE` + tagline `Rise. Reflect. Repeat.`
- Footer: `The Incline Life by Incline` · theincline.in
- Brand color: gold `#EAB308` on black `#000000` / `#111111`

## Current state (audit)

1. `supabase/functions/send-email/index.ts` already owns the branded shell and is fixed (`INCLINE` + `Rise. Reflect. Repeat.`, footer correct).
2. `dispatch-communication` already defaults `use_branded_template: true` for every email channel call. All worker functions (`notify-lead-created`, `deliver-scan-report`, `run-retention-nudges`, `contract-signing`, `process-comm-retry-queue`, `send-broadcast`) pass through it with branding ON. ✓
3. **Mismatch #1 — AI email drafter** (`supabase/functions/ai-draft-campaign-message/index.ts`):
   - Hardcodes `brand color #6d28d9` (violet) — wrong.
   - Defaults brand name to `"Incline Fitness"` — wrong.
   - Asks AI for a full standalone HTML document, which then either gets nested inside the shell or replaces it depending on path — inconsistent.
4. **Mismatch #2 — TemplateManager email preview** (`src/components/settings/TemplateManager.tsx:1351`):
   - Hardcoded `From: Incline Fitness <noreply@inclinefitness.in>` — should reflect `Incline <noreply@theincline.in>` to match real send identity, and the preview frame should render inside the same branded shell colours so what designers see ≈ what recipients get.
5. **AI WhatsApp templates** (`ai-generate-whatsapp-templates`): brand string only; WhatsApp has no HTML shell, so brand-name alignment to `"Incline"` only.

## Changes

### A. AI draft prompt — align with branded shell
File: `supabase/functions/ai-draft-campaign-message/index.ts`
- Change default `brand` from `"Incline Fitness"` → `"Incline"`.
- Rewrite `CHANNEL_RULES.email`:
  - Brand color: `#EAB308` on dark background (matches shell).
  - Output must be a **body-only HTML fragment** (no `<html>/<head>/<body>` wrappers, no inline `<style>` blocks). The branded shell injects fonts, header, footer, dark background; AI only writes the inner content.
  - Allowed tags: `<h1>…<h3>`, `<p>`, `<a>`, `<strong>`, `<ul>/<li>`, `<table class="details">`, plus the shell's `.cta-btn`, `.kpi`, `.kpi-label`, `.kpi-value` classes.
  - Single primary CTA using `<a class="cta-btn">`.
- Keep `subject`/`preheader`/`body_text` fields unchanged so plain-text fallback still works.

### B. AI WhatsApp/SMS prompt — brand name only
File: `supabase/functions/ai-generate-whatsapp-templates/index.ts` (and the `ai-draft-campaign-message` whatsapp/sms rules)
- Replace any `"Incline Fitness"` brand strings with `"Incline"` to stay consistent with public identity. No structural change.

### C. TemplateManager preview parity
File: `src/components/settings/TemplateManager.tsx`
- Fix the hardcoded `From:` line for email previews → `Incline <noreply@theincline.in>` (or pull from env if available).
- Render the email preview inside a small mimic of the branded shell (black header strip with `INCLINE` + tagline, gold underline, dark body, gold footer line) so what staff see in the manager matches what recipients receive. Pure presentational; no business-logic change.

### D. Branded shell — minor hardening
File: `supabase/functions/send-email/index.ts`
- Strip any `<html>`/`<head>`/`<body>` wrappers from incoming `html` payload before injecting into `.body` (defensive — protects against legacy AI drafts or imported templates that ship full HTML docs and would nest inside the shell).

## Out of scope
- Email domain / DNS / Resend setup (no change requested).
- Database template rows: no schema change. Existing `email_templates.content` keeps working — shell wraps it as today.

## Verification
1. Send a test broadcast email via Campaigns → confirm header reads `INCLINE / Rise. Reflect. Repeat.`, footer reads `The Incline Life by Incline`.
2. AI-draft an email in CampaignWizard → confirm output is a body fragment using `.cta-btn`, no nested `<html>` doc; preview shows it inside the shell.
3. Trigger a system email (lead alert, scan report) → identical shell.
4. Open Templates Hub → Email tab → preview matches the live shell branding.