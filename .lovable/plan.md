# Settings cleanup + failing background jobs

## 1. Remove the Website settings tab
- Remove "Website" from the Settings menu and its content.
- Delete `WebsiteSettings` and any files used only by it (checked with a search first; anything shared stays).
- Old links to `/settings?tab=website` fall back to the default Settings tab instead of a blank page.

## 2. Move "Marketing & Retention" out of Settings
- Move it into the Marketing / Campaigns area as a "Retention" tab next to Campaigns (it is a campaign tool, not a setting).
- Remove it from Settings; old `/settings?tab=retention` links redirect to the new place.
- Only owners/managers (same people who see it today) can open it.

## 3. "In-App scheduled alerts" failing (404)
- Cause confirmed: the scheduler calls the delivery worker, but the backend reports it "not found" — it is not live.
- Redeploy the worker, run the job once with "Run now", and confirm the status turns green. No real notifications go out unless a scheduled post is actually due.

## 4. "WhatsApp Retry Queue" (dead, disabled since August)
- It is already switched off and replaced by "Communication Retry Queue" (running fine).
- Delete the old rule so it stops showing in Automation Brain.

## 5. Standby copy fails at "prepare" (pgbouncer permission)
- The copy job reads the main database through the connection pooler, which now refuses its login check.
- Change it to use the direct database connection (as the project rule already requires), with a clear error message if that setting is missing, then start a fresh copy and confirm "prepare" passes.

## Technical notes
- Files: `src/pages/Settings.tsx`, `WebsiteSettings` (delete), marketing page hosting `RetentionCampaignManager`, `supabase/functions/dr-replicate/primary.ts`.
- Delete `automation_rules` row `process_whatsapp_retry_queue`.
- Redeploy `process-inapp-delivery`; verify via automation_rules last_status.
- If the direct DB URL secret is absent, the copy item stays open and I'll tell you.
