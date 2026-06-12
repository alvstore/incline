# Restore Lead Nurture Follow-up

## Root cause recap
1. **Brain dead since Jun 11 09:50 UTC.** `automation-brain` v2.2.0 added an auth gate requiring `Authorization: Bearer <SERVICE_KEY>` (or `apikey=SERVICE_KEY` + `x-system-call=automation-brain`). The pg_cron job `automation-brain-tick` (jobid 14) still posts only the ANON key, so every tick returns 401. All 15 automation rules have been silently frozen for ~29 hours — including `lead_nurture_followup`, `monitor_ai_lead_loss`, `process_whatsapp_retry_queue`, `process_scheduled_campaigns`, `process_ig_comment_runs`, `daily_send_reminders`, etc.
2. **Rahul's lead row is empty.** His conversation predates the deterministic email/name capture fix, so `leads.c33b3f77…` has `email=NULL`, `plan_interest=NULL`, `last_contacted_at=NULL`. Even with the brain restored, the nurture worker won't message a lead with no email or with no prior outbound timestamp depending on its eligibility filter.

## Plan

### Step 1 — Fix the cron auth headers (migration)
Re-schedule `automation-brain-tick` (jobid 14) so the HTTP POST includes the service-role bearer and the system-call marker the brain expects:

```sql
SELECT cron.unschedule('automation-brain-tick');
SELECT cron.schedule(
  'automation-brain-tick',
  '*/5 * * * *',
  $$ SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/automation-brain',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey', '<SERVICE_ROLE_KEY>',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'x-system-call', 'automation-brain'
    ),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 55000
  ); $$
);
```

Same pattern audited for the other cron-driven edge functions (`dr-health-probe-db`, `google-reviews-brain-fetch`, `reconcile-whatsapp-pending`, etc.) — if any of them also enforce service-role auth in code but receive only anon, fix in the same migration.

### Step 2 — Force-due all frozen rules
After the migration, `UPDATE automation_rules SET next_run_at = now() WHERE is_active = true AND next_run_at < now() - interval '1 hour';` so the next tick immediately processes the backlog instead of waiting for each rule's own cron.

### Step 3 — Backfill Rahul's lead (one-off SQL, no migration)
```sql
UPDATE leads
SET email = 'Rahulchaudhary872@gmail.com',
    full_name = COALESCE(NULLIF(full_name,''), 'Rahul'),
    last_contacted_at = '2026-06-10 17:25:32+00',
    updated_at = now()
WHERE id = 'c33b3f77-305f-4999-acdc-af96a7de4d2e'
  AND email IS NULL;
```
This makes him eligible for `lead_nurture_followup` on the next tick.

### Step 4 — Verify
- After ~5 min, confirm `automation_rules.last_run_at > now() - interval '10 min'` for every active rule.
- Check `automation_runs` for fresh `success` rows.
- Confirm `lead_nurture_followup` dispatched a message to +917737300273 (and other backlogged leads), and that `monitor_ai_lead_loss` didn't fire false-positive alerts on the 29-hour gap.
- Add a SystemHealth assertion: alert if `max(automation_rules.last_run_at) < now() - 30 min` so a future broken cron is caught within half an hour instead of days.

### Step 5 — Document the contract
Update mem `architecture/p3-workflow-hardening` (or `automation-brain` memory) with the required cron-call header contract so the next brain auth tightening can't desync from the cron command again.

## Out of scope
- Refactoring `lead-nurture-followup` worker logic itself.
- Backfilling other historical leads with missing email (only Rahul requested).
- UI changes to Automation Control Room.

## Files touched
- `supabase/migrations/<ts>_fix_automation_cron_auth.sql` (re-schedule + force-due + Rahul backfill)
- `mem://architecture/automation-brain-cron-auth-contract` (new or appended)
