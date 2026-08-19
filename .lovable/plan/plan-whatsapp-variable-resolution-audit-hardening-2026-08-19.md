# Plan: WhatsApp Variable Resolution Audit & Hardening

Auditing and resolving the issue where WhatsApp templates (Daily Ops & Lead Alerts) are arriving with empty dashes instead of actual data.

## Technical Details

### 1. Hardening Dispatch Communication Aliasing
Update `supabase/functions/dispatch-communication/index.ts` to include broader semantic aliases. Meta templates use positional slots ({{1}}, {{2}}), and we must map every possible CRM variable name to these slots to prevent "—" fallbacks.
- Add aliases: `interest`, `plan_interest`, `lead_source`, `utm_source`, `total_revenue`, `report_date`, `total_checkins`.
- Harden `safeFallbackForKey` to use "there" for all positional {{1}} slots to avoid "Hi —,".

### 2. Edge Function Payload Enrichment
Update `daily-ops-summary` and `notify-lead-created` to provide a redundant "flat" bag of variables, ensuring compatibility regardless of whether the Meta template uses `name` or `member_name`.

### 3. Verification
- Use `supabase--read_query` to verify that `communication_logs` for new sends carry the correct variables.
- Manually trigger `daily-ops-summary` in preview mode to inspect the generated payload.

## User Impact
Admins and owners will receive complete WhatsApp reports and lead alerts with names, revenue, and interest data instead of empty placeholders.
