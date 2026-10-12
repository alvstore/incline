# Direct Zoho Books connection, set up from the app

## Goal
Owners connect Zoho Books themselves from **Finance → GST tab → Zoho Books card**. They enter the Client ID and Client Secret, click "Connect with Zoho", approve on Zoho's page, and come back connected. No connector and no keys sent through chat. The current connector stays as a fallback until direct mode is switched on.

## What the owner sees
- **Zoho Books card (GST tab)** gets a "Connection" section with a status badge: Not configured / Connected (direct) / Using connector / Needs reconnect. It also shows the organisation name, data centre (India by default), when it was connected and by whom, and when it last synced.
- **"Set up direct connection" button** opens a right-side drawer with:
  1. Short steps: create a "Server-based Application" at api-console.zoho.in, and paste the shown **Redirect URL** (with a copy button).
  2. Fields: Client ID, Client Secret (hidden, with a show/hide button), data centre (in / com / eu), and an optional Organization ID.
  3. Save, then **Connect with Zoho**. This opens Zoho's approval page and returns to the GST tab with a success or error message.
- **Mode switch** (kill switch): Connector / Direct. Direct only works after a test passes. Switching back to Connector is instant.
- Buttons: **Test connection**, **Reconnect**, **Disconnect** (with a confirm popup). Disconnect wipes the stored secret and token.
- If the card isn't set up yet, Settings → Tax & GST shows a small "Zoho Books not connected" notice that links to the card.
- Owner/admin only. Managers and staff never see the secret fields.
- Accessibility: labelled fields, visible focus, 44px buttons, error messages read aloud, status shown with text and icon (not just colour).

## Security
- The secret and refresh token are saved only on the server, in a table that only the system can read. The browser never gets them back; it only sees "configured" and the last 4 characters of the Client ID.
- The approval link carries a one-time, short-lived code tied to the owner who started it. This stops anyone else from slipping in their own Zoho account.
- Every save, connect, mode change, test and disconnect is written to the audit log (without secret values).
- Token-refresh failures appear in System Health and flip the badge to "Needs reconnect". The sync never stops silently.

## Technical details
- **Migration**: `zoho_direct_credentials` (single row: client_id, client_secret, refresh_token, dc, organization_id, org_name, connected_by, connected_at, last_refresh_error), RLS on with no client policies and service_role only. `zoho_oauth_states` (state, user_id, expires_at, used_at). Feature flag `settings(branch_id NULL, key='zoho_mode')` = `connector|direct`, default `connector`. Read-only status RPC `zoho_connection_status()` with an owner/admin guard (`rpc_guard_applies` + `has_role`) and an explicit GRANT to authenticated, so it passes the definer-guard CI.
- **Edge fn `zoho-oauth`** (new, v1.0.0, CORS, try/catch, Zod): actions `save_credentials`, `start` (returns the Zoho authorize URL with scope `ZohoBooks.fullaccess.all`, `access_type=offline`, `prompt=consent`, and the state), `test`, `disconnect`, `set_mode`. Each one checks the JWT and owner/admin role in code.
- **Edge fn `zoho-oauth-callback`** (new, public GET): checks the state (unused and not expired), swaps the code at `accounts.zoho.{dc}/oauth/v2/token` for a refresh token, gets `/organizations` to fill in the org, stores it, and redirects to `/finance?tab=gst&zoho=connected|error`.
- **`zoho-books-sync` v1.7.0**: reads the mode and credentials from the database (env vars still work as a fallback), caches the access token in memory, and records refresh errors. Nothing else about the sync changes: GST-only eligibility, BOS skipped, HSN 999723, payment catch-up.
- **UI**: `ZohoBooksSyncCard.tsx` connection section + new `ZohoDirectSetupSheet.tsx` (Sheet, react-hook-form + zod, TanStack Query mutations with invalidation); Finance reads the `?tab=gst` query parameter; notice in `TaxGstSettings.tsx`.
- **Tests**: state expiry and one-time use; mode can't flip to direct without a passed test; non-owners get refused.
- **Verification**: deploy, run Test with real credentials, a dry-run sync in direct mode, then switch the mode and confirm a real sync. Rollback = mode back to Connector.

## What you need to provide
A Zoho "Server-based Application" (Client ID + Secret). You enter these in the drawer yourself; I can't create it for you.
