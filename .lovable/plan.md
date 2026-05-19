## What I found (audit)

**Where the data actually lives**
- The only IG integration row in the DB is `provider='instagram_meta'`, `integration_type='instagram'` (id `27f094d6…`).
- Its `credentials` has `access_token` + `app_secret` (no `page_access_token`).
- Its `config` has `page_id`, `instagram_account_id`, `webhook_verify_token`.

**Root cause of "Could not load posts. Token may be missing IG Graph scopes."**
In `supabase/functions/meta-admin/index.ts`:

```ts
function pickIgToken(integ) {
  const igId = cfg.ig_user_id || cfg.instagram_business_account_id || cfg.ig_account_id || null;
  // …missing cfg.instagram_account_id (the field the IG settings UI actually saves)
}
```

The query returns `igId = null`, so `handleListIgMedia` short-circuits with `"Missing IG token or account id"`, which the drawer surfaces as the generic "Token may be missing IG Graph scopes." — even though the token IS valid and Graph was never called.

Secondary issue: for `/{ig-user-id}/media` Graph endpoint via a Facebook Page (EAA token), Meta requires a **page access token**, not the user token. `credentials.page_access_token` is missing on this row, so even after fixing the id resolution, the call will likely 400 with "missing permissions". A `refresh_page_token` action already exists — we should call it automatically on miss.

**Where the IG Automations page lives today**
- Standalone page `src/pages/InstagramAutomations.tsx` at route `/instagram-automations`, linked from the sidebar.
- Communication Hub is `src/pages/Announcements.tsx` with tabs: `live | announcements | campaigns | retry`, driven by `?tab=` query string.

## Plan

### 1. Fix "Could not load posts" (executor + diagnostics)
File: `supabase/functions/meta-admin/index.ts`

- Extend `pickIgToken` id resolution to also read `cfg.instagram_account_id` and (last resort) `cfg.page_id`-based lookup.
- In `handleListIgMedia`:
  - If `credentials.page_access_token` is missing AND we have `cfg.page_id` + a user `access_token`, call the existing `/me/accounts` flow once to fetch+persist the page token (re-use logic from `handleRefreshPageToken`), then retry.
  - Return the **real** Graph error message (`j?.error?.message`) plus `error_subcode` / `type` so the UI can show "Permission `instagram_basic` missing" instead of a generic message.
- Same id-resolution fix applied to `handleListIgAccounts` and the executor's `loadIntegration` so end-to-end pipeline (test → media list → cron → send DM) all use the same resolver.

UI: `src/components/ig-automations/IgCampaignDrawer.tsx`
- Replace hard-coded toast text with the actual error message returned from the edge function. Add a "Reconnect Instagram" link when the error mentions missing token/scopes.

### 2. Move Instagram Automations into Communication Hub as a tab
- Extract the body of `src/pages/InstagramAutomations.tsx` (everything inside `<AppLayout>`) into a new presentational component `src/components/ig-automations/IgAutomationsPanel.tsx` that takes no props and uses `useBranchContext` internally — same as `CampaignsPanel`.
- `src/pages/Announcements.tsx`:
  - Add a 5th tab `instagram` between `campaigns` and `retry` with icon `Instagram` from lucide.
  - Render `<IgAutomationsPanel />` inside `<TabsContent value="instagram">`.
- `src/pages/InstagramAutomations.tsx`: convert to a `<Navigate to="/announcements?tab=instagram" replace />` shim (mirrors the existing `Campaigns.tsx` pattern) so existing bookmarks/sidebar links keep working.
- `src/config/menu.ts` + `src/config/navModules.ts`: update the Instagram Automations entry to point at `/announcements?tab=instagram` (keeps the same icon + label, just routes into the hub).

### 3. End-to-end verification
After the migration-free code changes deploy:

1. `supabase--deploy_edge_functions` for `meta-admin`.
2. `supabase--curl_edge_functions` POST `meta-admin` with `{action:"list_ig_accounts", branch_id:"<active>"}` → expect 1 account with `username` populated (no `error`).
3. Same with `{action:"list_ig_media", integration_id:"27f09…"}` → expect `media:[…]` array. If Graph rejects, the response body now contains the real error which we'll act on (likely needs `pages_show_list` / `instagram_basic` scope on the existing token — that's a Meta-side reconnect, not a code bug).
4. UI smoke: open `/announcements?tab=instagram` → drawer → "Refresh" on Target post → posts render or specific error displays.
5. Confirm legacy `/instagram-automations` still loads (redirects to the tab).
6. Run the existing test panel (`test_ig_comment_match`) to verify the matcher pipeline is untouched.

## Out of scope (won't change)
- No DB migrations.
- Do not touch IG DM ingestion (`meta-webhook`, `triggerAiReply`) — only the admin/list helpers.
- Do not change sidebar layout or any other Communication Hub tab.

## Risk
- If the existing IG token genuinely lacks the `instagram_basic` / `pages_show_list` scope, posts still won't load — but the UI will now say exactly that and link to reconnect, which is the correct outcome. Sending DMs via webhook continues to work because that path uses different scopes already granted.
