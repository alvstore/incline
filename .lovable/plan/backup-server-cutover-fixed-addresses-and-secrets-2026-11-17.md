# Backup server cutover: fixed addresses and secrets

## What I can do
1. **Sign-up form (RegisterModal)** — build the lead-capture address from the app's configured backend address instead of the fixed primary one, keeping the same form ID. On the backup copy it will then send leads to the backup automatically.
2. **Birthday greeting media** — the birthday video/poster links in the shared greeting helper also point at the primary backend. Build them from the running function's own backend address so the backup serves its own copies (files are already mirrored by the standby copy job).
3. Leave the origin-check test alone (it intentionally tests the primary address).

## What I cannot do: copying secret values
Saved secret values (LOVABLE_API_KEY, NVIDIA_API_KEY, GROK, RESEND_WEBHOOK_SECRET, WEBHOOK_LEAD_SECRET, MIPS_WEBHOOK_SECRET, MIPS_RELAY_SECRET, SMS_WEBHOOK_SECRET, LOG_INGEST_SECRET, FIREBASE_MESSAGING_API_KEY, ZOHO_BOOKS_API_KEY, TELINFY_BASE_URL, SETUP_TOKEN) are write-only for me — I can't read, print or send them anywhere, including your backup server. You'll need to paste them yourself:
- Get each value from its original source (provider dashboards: Lovable API key, NVIDIA, Grok, Resend, Firebase, Zoho, Telinfy, MIPS), because Lovable Cloud also doesn't show saved values back.
- Put them in `/opt/supabase-incline/volumes/functions/.env.secrets` on the backup server, one `NAME=value` per line, then recreate the functions container.
- Note: LOVABLE_API_KEY only works for this project; on the backup, AI should fall back to NVIDIA/Grok.

## Technical details
- `src/components/ui/RegisterModal.tsx:40` → `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-lead-capture?slug=…`.
- `supabase/functions/_shared/birthday-greeting.ts:21,25` → `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/template-media/…`, with the current address as fallback if unset; redeploy functions that import it.
