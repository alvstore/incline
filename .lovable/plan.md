## RCS Hub — Audit Findings & Fix Plan

### Audit (what's wrong today)

1. **Layout order is reversed.** `IntegrationSettings.tsx` line 361 renders `<RcsHub />` (5 tabs, KPIs, wallet card) BEFORE the `Provider credentials` card. So the operational hub appears even when Telinfy is disabled / no credentials saved → looks "hardcoded".
2. **Hub never checks `integration_settings.is_active`.** It always renders Overview/Templates/Test/Wallet/Webhooks regardless of integration state — no empty / disabled state, no setup CTA.
3. **Credential precedence is gated on `is_active`.** `send-rcs`, `rcs-templates-sync`, `rcs-wallet` all do `if (cfg?.is_active) apiKey = cfg.credentials.api_key`. If a user saves a key in the UI but forgets the toggle, the function silently falls back to a stale `TELINFY_API_KEY` env (which is the wrong key, producing the 401 we saw). DB-stored credentials should win whenever present, independent of the active toggle (the toggle should gate **dispatch**, not **key resolution**).
4. **No live status / health pill** at the top of the Hub. User has no way to tell from the Hub itself whether Telinfy is reachable with the saved key.
5. **Test Send payload bug.** `variables: { template_name: templateName, lcustomParam: vars }` wraps `vars` under a `lcustomParam` key inside `variables`, then `send-rcs` passes `variables` straight into `lcustomParam`. Net result: Telinfy receives `lcustomParam.lcustomParam = {...}` instead of the flat var map. Templates with placeholders will fail substitution.
6. **No reachability test action.** The Sheet has a "Test" button for credentials, but the Hub itself can't trigger a wallet/templates probe to confirm the key works end-to-end.
7. **Minor UX:** "Beta" pill next to title is fine, but the Hub header doesn't carry the active provider name (Telinfy / GreenAds Global) or a "Configured / Not configured" status, and the wallet hero card shows a giant "—" with no CTA when empty.

### Fix Plan (UI/UX + correctness, no business-logic changes)

**A. Re-order the RCS tab (frontend only)**

```text
RCS tab
├── 1. Provider credentials card        ← FIRST
│     • Telinfy / GreenAds Global  [Active|Inactive]  Configure
│     • MSG91 RCS                  [Inactive]         Setup
└── 2. RcsHub                            ← SECOND (collapsed/disabled state when off)
      • header shows: Telinfy status pill + last reachability check
      • if not configured → empty state with "Configure Telinfy" button that opens the same Sheet
      • if configured but inactive → warning banner "Integration disabled — enable to send"
      • if active → tabs render as today
```

**B. RcsHub component changes (`src/components/settings/rcs/RcsHub.tsx`)**
- Query `integration_settings` for `rcs / telinfy` (branch + global) at the top → derive `{ saved, isActive, baseUrl }`.
- Three render states:
  - **not saved** → dashed empty card: "Telinfy RCS isn't connected yet. Add your `x-api-key` to start." + button that scrolls to / opens the credentials Sheet.
  - **saved but inactive** → amber banner "Saved but disabled — flip the toggle to send." Tabs visible but Send buttons disabled with tooltip.
  - **active** → current behavior, plus a green "Connected" pill + "Test connection" button (calls `rcs-wallet` once and toasts ok/fail).
- Fix Test Send payload: send `variables: vars` (flat map), drop the nested `lcustomParam`/`template_name` keys.
- Wallet hero: when empty, show "Sync wallet" button inline instead of just "—".

**C. Edge-function credential resolution (`send-rcs`, `rcs-templates-sync`, `rcs-wallet`)**
- Change the resolver from "use DB only when `is_active`" to:
  - If `cfg?.credentials?.api_key` exists → use it (and `config.base_url` if set).
  - `is_active=false` only blocks **outbound sends in `send-rcs`** (return `{status:'disabled'}`), not key resolution for templates/wallet probes.
- Keeps env vars as last-resort fallback.

**D. Visual polish (Vuexy tokens, no new colors)**
- Hub header: small "Telinfy" sublabel under title, status pill (`Connected` emerald / `Disabled` amber / `Not configured` slate), last-checked timestamp.
- Wallet hero gradient kept, but shrinks to half width and adds a "Refresh" icon button.
- Tabs: keep 5, but Wallet tab disabled with lock icon when user lacks `rcs_wallet_view`.
- Provider credentials card grid: add an `aria-live` region for save/test results.

### Files touched

- `src/components/settings/IntegrationSettings.tsx` — swap render order, pass `onConfigureClick` into Hub.
- `src/components/settings/rcs/RcsHub.tsx` — add config query, state machine, fix Test Send payload, header status pill, empty/inactive states, "Test connection" button.
- `supabase/functions/send-rcs/index.ts` — resolver uses creds regardless of `is_active`; `is_active=false` short-circuits with `{status:'disabled'}`.
- `supabase/functions/rcs-templates-sync/index.ts` — resolver uses creds regardless of `is_active`.
- `supabase/functions/rcs-wallet/index.ts` — same resolver fix.

### Out of scope (call out, don't change)
- No new tables, no migrations, no RLS changes.
- MSG91 RCS dispatcher remains a "credentials only" stub.
- No changes to `dispatch-communication` routing or `communication_logs` schema.

### Verification
1. Disable Telinfy toggle → Hub shows amber "disabled" banner; Send buttons disabled; templates/wallet still load if a key is saved.
2. Clear saved key → Hub shows "Not configured" empty state with Configure CTA.
3. Enable toggle with valid key → "Connected" pill; Test Send to `+919887601200` reaches Telinfy with flat `lcustomParam` map; delivery status updates via webhook.
4. Click "Test connection" → toasts wallet balance or precise error from Telinfy.