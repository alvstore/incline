# DR Secrets Checklist

Project secrets are NOT mirrored by the nightly `dr-replicate` job — Supabase
doesn't expose vault secret values over the API. After a real failover, the
following names must exist on the standby project (`pmznpbsahetwmogezhff`)
with the same values as the primary.

> Owner-only operation. Re-paste values once at standby setup; rotate together
> with the primary going forward.

| Secret name | Where it's used | Notes |
|---|---|---|
| `SUPABASE_URL` | every edge fn | auto-injected by Supabase; nothing to paste |
| `SUPABASE_ANON_KEY` | every edge fn | auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | every edge fn | auto-injected |
| `DR_SERVICE_ROLE_KEY` | `dr-replicate` (primary only) | service-role JWT of the **standby**; do NOT set on the standby itself |
| `LOVABLE_API_KEY` | AI brain, draft-campaign, ai-* fns | managed; rotate via Lovable Cloud UI, not paste |
| `RAZORPAY_KEY_ID` | `create-payment-order`, `verify-payment`, `create-razorpay-link` | from Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | same as above | private |
| `RAZORPAY_WEBHOOK_SECRET` | `payment-webhook` | signature verification |
| `META_APP_ID` | `meta-oauth-callback`, `meta-webhook`, `send-meta-dm` | from Meta developer console |
| `META_APP_SECRET` | same | private |
| `META_VERIFY_TOKEN` | `meta-webhook`, `whatsapp-webhook` | string you chose; must match Meta config |
| `WHATSAPP_*` fallbacks | only if global `integration_settings` row is missing | preferred: use `integration_settings` table instead |
| `ROUNDSMS_API_KEY` | `send-sms` (and fallback) | from RoundSMS dashboard |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | `send-email` | one of them, depending on configured provider |
| `HOWBODY_DB_HOST` / `HOWBODY_DB_USER` / `HOWBODY_DB_PASSWORD` | `howbody-*` fns | HOWBODY scanner backend |
| `GOOGLE_PLACES_API_KEY` | `request-google-review`, `google-review-redirect` | Google Cloud console |

After pasting:

1. Re-deploy edge functions to the standby: `./scripts/dr/sync-edge-functions.sh`
2. Re-apply the cron manifest (see `docs/dr-runbook.md` § failover).
3. Trigger one `Sync to fallback now` run to confirm everything wires up.
