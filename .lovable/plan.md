## Instagram integrations audit (EAA + IGAA)

### What the two cards mean

```text
INSTAGRAM_PROVIDERS (UI)
├─ instagram_meta   →  "Instagram via Facebook (EAA)"    Page Access Token, FB Page required
└─ instagram_login  →  "Instagram Business Login (IGAA)" Direct IG token (IGAA…), no FB Page
```

Both rows live in `integration_settings` with `integration_type = 'instagram'`; the two flows are **only** distinguished by `provider`. Edge functions auto-detect host (`graph.facebook.com` vs `graph.instagram.com`) from the token prefix via `detectMetaHost()` in `_shared/meta-config.ts`.

### Current state in the database

```text
provider           integration_type   is_active   notes
─────────────────  ─────────────────  ──────────  ──────────────────────────
instagram_meta     instagram          true        the working EAA row
(no instagram_login row exists)
```

### Bugs found

1. **CRITICAL — IGAA OAuth insert writes the wrong column name.**
   `supabase/functions/meta-oauth-callback/index.ts` line 179-186 inserts:
   ```ts
   { branch_id, provider: "instagram_login", type: "instagram", credentials, config, is_active: true }
   ```
   The table column is `integration_type`, not `type`. Postgres rejects the insert, so the OAuth flow can never persist an IGAA connection. (Update path on line 174 is fine because it doesn't touch the column.)

2. **No manual configuration schema for IGAA.**
   `src/config/providerSchemas.ts` has `instagram_instagram_meta` but no `instagram_instagram_login`. The Configure sheet therefore shows the screenshot's *"No configuration schema available for this provider. Contact support."* and the IGAA card can never be saved manually.

3. **Display-name map is missing the IGAA entry.**
   `getProviderDisplayName` at line 50-60 only maps `instagram_meta → 'Instagram Direct (Meta)'`. IGAA rows would display the raw key `instagram login`. Also the label `'Instagram Direct (Meta)'` doesn't match the card title `'Instagram via Facebook (EAA)'`.

4. **Active-badge / diagnostics filters use the wrong discriminator.**
   `src/components/settings/IntegrationSettings.tsx` repeatedly checks
   `integration_type === 'instagram' || integration_type === 'instagram_login'`
   (lines 111, 422, 698, 727, 756). Since both flows save `integration_type='instagram'`, the IGAA branch is dead. The correct discriminator is `provider === 'instagram_login'`. Same dead branch in `meta-webhook/index.ts` line 865 fallback.

### Fix plan

**A. Repair OAuth insert (1-line)**
- `supabase/functions/meta-oauth-callback/index.ts` — rename `type: "instagram"` → `integration_type: "instagram"`, bump file version comment.

**B. Add IGAA manual config schema** in `src/config/providerSchemas.ts`:
```ts
instagram_instagram_login: [
  { key: 'instagram_user_id',    label: 'Instagram User ID',  placeholder: 'From Meta → Instagram product → API setup', type: 'text',     section: 'config' },
  { key: 'webhook_verify_token', label: 'Webhook Verify Token', placeholder: 'Any secret string you choose',           type: 'text',     section: 'config' },
  { key: 'access_token',         label: 'Access Token (IGAA…)', placeholder: 'IGAA…',                                  type: 'password', section: 'credentials' },
  { key: 'app_secret',           label: 'Instagram App Secret', placeholder: 'Meta → Instagram product → API setup',   type: 'password', section: 'credentials' },
]
```

**C. Align display names**
- `getProviderDisplayName` map → `instagram: { instagram_meta: 'Instagram via Facebook (EAA)', instagram_login: 'Instagram Business Login (IGAA)' }`.

**D. Replace dead `integration_type === 'instagram_login'` checks with `provider === 'instagram_login'`** in:
- `src/components/settings/IntegrationSettings.tsx` (5 occurrences) — so the "Active" badge and the Diagnostics / Refresh buttons recognize an IGAA row when it actually exists.
- `supabase/functions/meta-webhook/index.ts` line ~865 fallback list (cosmetic, but worth fixing while we're there).

### Files touched

- `supabase/functions/meta-oauth-callback/index.ts`
- `src/config/providerSchemas.ts`
- `src/components/settings/IntegrationSettings.tsx`
- `supabase/functions/meta-webhook/index.ts` (small)

### Out of scope

- No DB migration (schema already correct; just code bugs).
- No new OAuth UI button — manual config schema unblocks the IGAA card today; an "Connect with Instagram" CTA can be added later if you want true 1-click OAuth.
- WhatsApp / Messenger flows untouched.
